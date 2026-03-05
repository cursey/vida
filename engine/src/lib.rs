use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

use goblin::pe::PE;
use iced_x86::{
    Decoder, DecoderOptions, FlowControl, Formatter, GasFormatter, Instruction, Mnemonic,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;

const INVALID_STREAK_LIMIT: usize = 3;
const DEFAULT_MAX_INSTRUCTIONS: usize = 512;
const MAX_MAX_INSTRUCTIONS: usize = 4096;

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub jsonrpc: String,
    pub id: Value,
    pub method: String,
    pub params: Value,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum RpcResponse {
    Success {
        jsonrpc: &'static str,
        id: Value,
        result: Value,
    },
    Error {
        jsonrpc: &'static str,
        id: Value,
        error: RpcError,
    },
}

#[derive(Debug, Serialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<RpcErrorData>,
}

#[derive(Debug, Serialize)]
pub struct RpcErrorData {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("Invalid JSON-RPC request")]
    InvalidRequest,
    #[error("Method not found")]
    MethodNotFound,
    #[error("Invalid params")]
    InvalidParams(String),
    #[error("I/O error: {0}")]
    Io(String),
    #[error("Unsupported binary format")]
    UnsupportedFormat,
    #[error("Unsupported architecture")]
    UnsupportedArch,
    #[error("Module not found")]
    ModuleNotFound,
    #[error("Invalid address")]
    InvalidAddress,
    #[error("Engine internal error: {0}")]
    Internal(String),
}

impl EngineError {
    fn code(&self) -> i64 {
        match self {
            Self::InvalidRequest => -32600,
            Self::MethodNotFound => -32601,
            Self::InvalidParams(_) => -32602,
            _ => -32000,
        }
    }

    fn engine_code(&self) -> &'static str {
        match self {
            Self::InvalidRequest => "INVALID_REQUEST",
            Self::MethodNotFound => "METHOD_NOT_FOUND",
            Self::InvalidParams(_) => "INVALID_PARAMS",
            Self::Io(_) => "IO_ERROR",
            Self::UnsupportedFormat => "UNSUPPORTED_FORMAT",
            Self::UnsupportedArch => "UNSUPPORTED_ARCH",
            Self::ModuleNotFound => "MODULE_NOT_FOUND",
            Self::InvalidAddress => "INVALID_ADDRESS",
            Self::Internal(_) => "ENGINE_INTERNAL",
        }
    }
}

#[derive(Debug, Deserialize)]
struct EnginePingParams {}

#[derive(Debug, Serialize)]
struct EnginePingResult {
    version: String,
}

#[derive(Debug, Deserialize)]
struct ModuleOpenParams {
    path: String,
}

#[derive(Debug, Serialize)]
struct ModuleOpenResult {
    #[serde(rename = "moduleId")]
    module_id: String,
    arch: &'static str,
    #[serde(rename = "imageBase")]
    image_base: String,
    #[serde(rename = "entryRva")]
    entry_rva: String,
}

#[derive(Debug, Deserialize)]
struct ModuleInfoParams {
    #[serde(rename = "moduleId")]
    module_id: String,
}

#[derive(Debug, Serialize)]
struct ModuleInfoResult {
    sections: Vec<SectionInfo>,
    imports: Vec<ImportInfo>,
    exports: Vec<ExportInfo>,
}

#[derive(Debug, Serialize)]
struct SectionInfo {
    name: String,
    #[serde(rename = "startRva")]
    start_rva: String,
    #[serde(rename = "endRva")]
    end_rva: String,
    #[serde(rename = "rawOffset")]
    raw_offset: usize,
    #[serde(rename = "rawSize")]
    raw_size: usize,
}

#[derive(Debug, Serialize)]
struct ImportInfo {
    library: String,
    name: String,
    #[serde(rename = "addressRva")]
    address_rva: String,
}

#[derive(Debug, Serialize)]
struct ExportInfo {
    name: String,
    start: String,
}

#[derive(Debug, Deserialize)]
struct FunctionListParams {
    #[serde(rename = "moduleId")]
    module_id: String,
}

#[derive(Debug, Serialize)]
struct FunctionSeed {
    start: String,
    name: String,
    kind: &'static str,
}

#[derive(Debug, Serialize)]
struct FunctionListResult {
    functions: Vec<FunctionSeed>,
}

#[derive(Debug, Deserialize)]
struct LinearDisassemblyParams {
    #[serde(rename = "moduleId")]
    module_id: String,
    start: String,
    #[serde(rename = "maxInstructions")]
    max_instructions: Option<usize>,
}

#[derive(Debug, Serialize)]
struct LinearDisassemblyResult {
    instructions: Vec<InstructionRow>,
    #[serde(rename = "stopReason")]
    stop_reason: &'static str,
}

#[derive(Debug, Serialize)]
struct InstructionRow {
    address: String,
    bytes: String,
    mnemonic: String,
    operands: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "branchTarget")]
    branch_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "callTarget")]
    call_target: Option<String>,
}

#[derive(Debug)]
struct ModuleState {
    _path: PathBuf,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
struct SectionSlice {
    start_rva: u64,
    end_rva: u64,
    raw_start: usize,
    raw_end: usize,
}

#[derive(Default)]
pub struct EngineState {
    next_module_id: usize,
    modules: HashMap<String, ModuleState>,
}

impl EngineState {
    pub fn handle_request(&mut self, request: RpcRequest) -> RpcResponse {
        if request.jsonrpc != "2.0" || !is_valid_request_id(&request.id) {
            return rpc_error(
                request.id,
                EngineError::InvalidRequest,
                Some(json!({ "reason": "jsonrpc must be 2.0 and id must be string/integer" })),
            );
        }

        let response = match request.method.as_str() {
            "engine.ping" => self
                .method_ping(parse_params::<EnginePingParams>(request.params))
                .and_then(to_json_value),
            "module.open" => self
                .method_module_open(parse_params::<ModuleOpenParams>(request.params))
                .and_then(to_json_value),
            "module.info" => self
                .method_module_info(parse_params::<ModuleInfoParams>(request.params))
                .and_then(to_json_value),
            "function.list" => self
                .method_function_list(parse_params::<FunctionListParams>(request.params))
                .and_then(to_json_value),
            "function.disassembleLinear" => self
                .method_disassemble_linear(parse_params::<LinearDisassemblyParams>(request.params))
                .and_then(to_json_value),
            _ => Err(EngineError::MethodNotFound),
        };

        match response {
            Ok(result) => RpcResponse::Success {
                jsonrpc: "2.0",
                id: request.id,
                result,
            },
            Err(error) => rpc_error(request.id, error, None),
        }
    }

    fn method_ping(
        &mut self,
        _params: Result<EnginePingParams, EngineError>,
    ) -> Result<EnginePingResult, EngineError> {
        Ok(EnginePingResult {
            version: env!("CARGO_PKG_VERSION").to_owned(),
        })
    }

    fn method_module_open(
        &mut self,
        params: Result<ModuleOpenParams, EngineError>,
    ) -> Result<ModuleOpenResult, EngineError> {
        let params = params?;
        let path = PathBuf::from(params.path);
        let bytes = fs::read(&path).map_err(|error| EngineError::Io(error.to_string()))?;
        let pe = parse_pe64(&bytes)?;
        let image_base = pe.image_base as u64;
        let entry_rva = pe.entry as u64;

        self.next_module_id += 1;
        let module_id = format!("m{}", self.next_module_id);

        self.modules
            .insert(module_id.clone(), ModuleState { _path: path, bytes });

        Ok(ModuleOpenResult {
            module_id,
            arch: "x64",
            image_base: to_hex(image_base),
            entry_rva: to_hex(entry_rva),
        })
    }

    fn method_module_info(
        &mut self,
        params: Result<ModuleInfoParams, EngineError>,
    ) -> Result<ModuleInfoResult, EngineError> {
        let params = params?;
        let module = self
            .modules
            .get(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;
        let pe = parse_pe64(&module.bytes)?;

        let mut sections = Vec::new();
        for section in &pe.sections {
            let start_rva = section.virtual_address as u64;
            let section_len = u64::from(section.virtual_size.max(section.size_of_raw_data));
            let end_rva = start_rva.saturating_add(section_len);
            sections.push(SectionInfo {
                name: section
                    .name()
                    .map(|value| value.trim_end_matches('\0').to_owned())
                    .unwrap_or_else(|_| "<invalid>".to_owned()),
                start_rva: to_hex(start_rva),
                end_rva: to_hex(end_rva),
                raw_offset: section.pointer_to_raw_data as usize,
                raw_size: section.size_of_raw_data as usize,
            });
        }

        let mut imports = Vec::new();
        for import in &pe.imports {
            imports.push(ImportInfo {
                library: import.dll.to_owned(),
                name: import.name.to_string(),
                address_rva: to_hex(import.rva as u64),
            });
        }

        let mut exports = Vec::new();
        for export in &pe.exports {
            exports.push(ExportInfo {
                name: export.name.unwrap_or("<unnamed>").to_owned(),
                start: to_hex(export.rva as u64),
            });
        }

        Ok(ModuleInfoResult {
            sections,
            imports,
            exports,
        })
    }

    fn method_function_list(
        &mut self,
        params: Result<FunctionListParams, EngineError>,
    ) -> Result<FunctionListResult, EngineError> {
        let params = params?;
        let module = self
            .modules
            .get(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;
        let pe = parse_pe64(&module.bytes)?;

        let mut ordered = BTreeMap::new();
        ordered.insert(
            pe.entry as u64,
            FunctionSeed {
                start: to_hex(pe.entry as u64),
                name: "entry".to_owned(),
                kind: "entry",
            },
        );

        for export in &pe.exports {
            let rva = export.rva as u64;
            ordered.entry(rva).or_insert_with(|| FunctionSeed {
                start: to_hex(rva),
                name: export.name.unwrap_or("<unnamed>").to_owned(),
                kind: "export",
            });
        }

        Ok(FunctionListResult {
            functions: ordered.into_values().collect(),
        })
    }

    fn method_disassemble_linear(
        &mut self,
        params: Result<LinearDisassemblyParams, EngineError>,
    ) -> Result<LinearDisassemblyResult, EngineError> {
        let params = params?;
        let module = self
            .modules
            .get(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;
        let pe = parse_pe64(&module.bytes)?;

        let start_rva = parse_hex_u64(&params.start)?;
        let section = find_section_for_rva(&pe, start_rva).ok_or(EngineError::InvalidAddress)?;

        let max_instructions = params
            .max_instructions
            .unwrap_or(DEFAULT_MAX_INSTRUCTIONS)
            .min(MAX_MAX_INSTRUCTIONS);

        let decode_window = module
            .bytes
            .get(section.raw_start..section.raw_end)
            .ok_or(EngineError::InvalidAddress)?;

        let start_offset_within_section = (start_rva - section.start_rva) as usize;
        let decode_slice = decode_window
            .get(start_offset_within_section..)
            .ok_or(EngineError::InvalidAddress)?;

        let image_base = pe.image_base as u64;
        let mut decoder = Decoder::with_ip(
            64,
            decode_slice,
            image_base + start_rva,
            DecoderOptions::NONE,
        );
        let mut formatter = GasFormatter::new();

        let mut stop_reason = "end_of_data";
        let mut invalid_streak = 0usize;
        let mut instructions = Vec::new();

        while instructions.len() < max_instructions {
            if !decoder.can_decode() {
                stop_reason = "end_of_data";
                break;
            }

            let current_va = decoder.ip();
            let current_rva = current_va.saturating_sub(image_base);

            if current_rva < section.start_rva || current_rva >= section.end_rva {
                stop_reason = "left_section";
                break;
            }

            let position_before = decoder.position();
            let mut instruction = Instruction::default();
            decoder.decode_out(&mut instruction);

            if instruction.mnemonic() == Mnemonic::INVALID || instruction.len() == 0 {
                invalid_streak += 1;
                if invalid_streak >= INVALID_STREAK_LIMIT {
                    stop_reason = "invalid_instruction_streak";
                    break;
                }
                continue;
            }

            invalid_streak = 0;

            let instruction_len = instruction.len() as usize;
            let start = position_before;
            let end = position_before.saturating_add(instruction_len);
            let encoded_bytes = decode_slice.get(start..end).ok_or_else(|| {
                EngineError::Internal("Instruction bytes are out of decode range".to_owned())
            })?;

            let mut instruction_text = String::new();
            formatter.format(&instruction, &mut instruction_text);
            let (mnemonic, operands) = split_instruction_text(&instruction_text);

            let branch_target = match instruction.flow_control() {
                FlowControl::ConditionalBranch | FlowControl::UnconditionalBranch => {
                    to_rva_hex(instruction.near_branch_target(), image_base)
                }
                _ => None,
            };

            let call_target = match instruction.flow_control() {
                FlowControl::Call => to_rva_hex(instruction.near_branch_target(), image_base),
                _ => None,
            };

            instructions.push(InstructionRow {
                address: to_hex(current_rva),
                bytes: bytes_to_hex(encoded_bytes),
                mnemonic,
                operands,
                branch_target,
                call_target,
            });

            if instruction.flow_control() == FlowControl::Return {
                stop_reason = "ret";
                break;
            }
        }

        if instructions.len() >= max_instructions {
            stop_reason = "max_instructions";
        }

        Ok(LinearDisassemblyResult {
            instructions,
            stop_reason,
        })
    }
}

fn is_valid_request_id(value: &Value) -> bool {
    value.is_string() || value.is_u64() || value.is_i64()
}

fn parse_params<T>(params: Value) -> Result<T, EngineError>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(params).map_err(|error| EngineError::InvalidParams(error.to_string()))
}

fn to_json_value<T>(value: T) -> Result<Value, EngineError>
where
    T: Serialize,
{
    serde_json::to_value(value).map_err(|error| EngineError::Internal(error.to_string()))
}

fn parse_pe64(bytes: &[u8]) -> Result<PE<'_>, EngineError> {
    let pe = PE::parse(bytes).map_err(|_| EngineError::UnsupportedFormat)?;
    if !pe.is_64 {
        return Err(EngineError::UnsupportedArch);
    }
    Ok(pe)
}

fn find_section_for_rva(pe: &PE<'_>, rva: u64) -> Option<SectionSlice> {
    for section in &pe.sections {
        let start_rva = section.virtual_address as u64;
        let section_len = u64::from(section.virtual_size.max(section.size_of_raw_data));
        let end_rva = start_rva.saturating_add(section_len);

        if rva >= start_rva && rva < end_rva {
            let raw_start = section.pointer_to_raw_data as usize;
            let raw_size = section.size_of_raw_data as usize;
            let raw_end = raw_start.saturating_add(raw_size);

            return Some(SectionSlice {
                start_rva,
                end_rva,
                raw_start,
                raw_end,
            });
        }
    }

    None
}

fn split_instruction_text(text: &str) -> (String, String) {
    let trimmed = text.trim();
    if let Some((mnemonic, operands)) = trimmed.split_once(' ') {
        return (mnemonic.to_owned(), operands.trim().to_owned());
    }
    (trimmed.to_owned(), String::new())
}

fn to_rva_hex(target_va: u64, image_base: u64) -> Option<String> {
    if target_va < image_base {
        return None;
    }
    Some(to_hex(target_va - image_base))
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<String>>()
        .join(" ")
}

fn parse_hex_u64(value: &str) -> Result<u64, EngineError> {
    let trimmed = value.trim();
    let no_prefix = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .ok_or(EngineError::InvalidAddress)?;
    u64::from_str_radix(no_prefix, 16).map_err(|_| EngineError::InvalidAddress)
}

fn to_hex(value: u64) -> String {
    format!("0x{value:X}")
}

fn rpc_error(id: Value, error: EngineError, details: Option<Value>) -> RpcResponse {
    RpcResponse::Error {
        jsonrpc: "2.0",
        id,
        error: RpcError {
            code: error.code(),
            message: error.to_string(),
            data: Some(RpcErrorData {
                code: error.engine_code().to_owned(),
                details,
            }),
        },
    }
}

pub fn run_stdio_server() -> Result<(), EngineError> {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    let mut state = EngineState::default();

    for line in stdin.lock().lines() {
        let line = line.map_err(|error| EngineError::Io(error.to_string()))?;
        if line.trim().is_empty() {
            continue;
        }

        let parsed_request = match serde_json::from_str::<RpcRequest>(&line) {
            Ok(request) => request,
            Err(_) => {
                let response = rpc_error(Value::Null, EngineError::InvalidRequest, None);
                let encoded = serde_json::to_string(&response)
                    .map_err(|error| EngineError::Internal(error.to_string()))?;
                writeln!(stdout, "{encoded}")
                    .map_err(|error| EngineError::Io(error.to_string()))?;
                stdout
                    .flush()
                    .map_err(|error| EngineError::Io(error.to_string()))?;
                continue;
            }
        };

        let response = state.handle_request(parsed_request);
        let encoded = serde_json::to_string(&response)
            .map_err(|error| EngineError::Internal(error.to_string()))?;
        writeln!(stdout, "{encoded}").map_err(|error| EngineError::Io(error.to_string()))?;
        stdout
            .flush()
            .map_err(|error| EngineError::Io(error.to_string()))?;
    }

    Ok(())
}

pub fn fixture_path(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hex_addresses() {
        assert_eq!(parse_hex_u64("0x10").expect("valid"), 16);
        assert!(parse_hex_u64("10").is_err());
    }

    #[test]
    fn rejects_invalid_request_id_type() {
        let mut state = EngineState::default();
        let response = state.handle_request(RpcRequest {
            jsonrpc: "2.0".to_owned(),
            id: Value::Bool(true),
            method: "engine.ping".to_owned(),
            params: json!({}),
        });

        assert!(matches!(response, RpcResponse::Error { .. }));
    }
}
