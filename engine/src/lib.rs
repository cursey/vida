use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

use goblin::pe::PE;
use goblin::pe::exception::RuntimeFunction;
use iced_x86::{
    Decoder, DecoderOptions, FlowControl, Formatter, GasFormatter, Instruction, Mnemonic,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;

const INVALID_STREAK_LIMIT: usize = 3;
const DEFAULT_MAX_INSTRUCTIONS: usize = 512;
const MAX_MAX_INSTRUCTIONS: usize = 4096;
const DATA_GROUP_SIZE: u64 = 16;
const LINEAR_ROW_HEIGHT: u64 = 24;
const MAX_LINEAR_PAGE_ROWS: usize = 4096;
const IMAGE_SCN_MEM_EXECUTE: u32 = 0x20000000;

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

#[derive(Debug, Deserialize)]
struct LinearViewInfoParams {
    #[serde(rename = "moduleId")]
    module_id: String,
}

#[derive(Debug, Serialize)]
struct LinearViewInfoResult {
    #[serde(rename = "rowCount")]
    row_count: u64,
    #[serde(rename = "minRva")]
    min_rva: String,
    #[serde(rename = "maxRva")]
    max_rva: String,
    #[serde(rename = "rowHeight")]
    row_height: u64,
    #[serde(rename = "dataGroupSize")]
    data_group_size: u64,
}

#[derive(Debug, Deserialize)]
struct LinearRowsParams {
    #[serde(rename = "moduleId")]
    module_id: String,
    #[serde(rename = "startRow")]
    start_row: u64,
    #[serde(rename = "rowCount")]
    row_count: u64,
}

#[derive(Debug, Serialize)]
struct LinearRowsResult {
    rows: Vec<LinearViewRow>,
}

#[derive(Debug, Deserialize)]
struct LinearFindRowByRvaParams {
    #[serde(rename = "moduleId")]
    module_id: String,
    rva: String,
}

#[derive(Debug, Serialize)]
struct LinearFindRowByRvaResult {
    #[serde(rename = "rowIndex")]
    row_index: u64,
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

#[derive(Debug, Serialize)]
struct LinearViewRow {
    kind: &'static str,
    address: String,
    bytes: String,
    mnemonic: String,
    operands: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "branchTarget")]
    branch_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "callTarget")]
    call_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    comment: Option<String>,
}

#[derive(Debug)]
struct ModuleState {
    _path: PathBuf,
    bytes: Vec<u8>,
    linear_view: Option<LinearView>,
}

#[derive(Debug, Clone)]
struct SectionSlice {
    start_rva: u64,
    end_rva: u64,
    raw_start: usize,
    raw_end: usize,
}

#[derive(Debug)]
struct LinearView {
    row_count: u64,
    min_rva: u64,
    max_rva: u64,
    segments: Vec<LinearSegment>,
}

#[derive(Debug)]
struct LinearSegment {
    start_row: u64,
    row_count: u64,
    start_rva: u64,
    end_rva: u64,
    kind: LinearSegmentKind,
}

#[derive(Debug)]
enum LinearSegmentKind {
    Exec(ExecSegment),
    Data,
    Gap,
}

#[derive(Debug)]
struct ExecSegment {
    rows: Vec<ExecRowIndex>,
}

#[derive(Debug)]
struct ExecRowIndex {
    rva: u64,
    len: u8,
    decoded: bool,
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
            "linear.getViewInfo" => self
                .method_linear_get_view_info(parse_params::<LinearViewInfoParams>(request.params))
                .and_then(to_json_value),
            "linear.getRows" => self
                .method_linear_get_rows(parse_params::<LinearRowsParams>(request.params))
                .and_then(to_json_value),
            "linear.findRowByRva" => self
                .method_linear_find_row_by_rva(parse_params::<LinearFindRowByRvaParams>(
                    request.params,
                ))
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

        self.modules.insert(
            module_id.clone(),
            ModuleState {
                _path: path,
                bytes,
                linear_view: None,
            },
        );

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

        for rva in collect_exception_function_starts(&pe) {
            ordered.entry(rva).or_insert_with(|| FunctionSeed {
                start: to_hex(rva),
                name: format!("exception_{}", to_hex(rva)),
                kind: "exception",
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

    fn method_linear_get_view_info(
        &mut self,
        params: Result<LinearViewInfoParams, EngineError>,
    ) -> Result<LinearViewInfoResult, EngineError> {
        let params = params?;
        let module = self
            .modules
            .get_mut(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;

        ensure_linear_view(module)?;
        let view = module
            .linear_view
            .as_ref()
            .ok_or_else(|| EngineError::Internal("Linear view missing".to_owned()))?;

        Ok(LinearViewInfoResult {
            row_count: view.row_count,
            min_rva: to_hex(view.min_rva),
            max_rva: to_hex(view.max_rva),
            row_height: LINEAR_ROW_HEIGHT,
            data_group_size: DATA_GROUP_SIZE,
        })
    }

    fn method_linear_get_rows(
        &mut self,
        params: Result<LinearRowsParams, EngineError>,
    ) -> Result<LinearRowsResult, EngineError> {
        let params = params?;
        let module = self
            .modules
            .get_mut(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;

        ensure_linear_view(module)?;
        let view = module
            .linear_view
            .as_ref()
            .ok_or_else(|| EngineError::Internal("Linear view missing".to_owned()))?;
        let pe = parse_pe64(&module.bytes)?;

        let requested = params.row_count.min(MAX_LINEAR_PAGE_ROWS as u64) as usize;
        let start_row = params.start_row.min(view.row_count);
        let end_row = (start_row + requested as u64).min(view.row_count);

        let mut rows = Vec::with_capacity(requested);
        for row_index in start_row..end_row {
            rows.push(materialize_linear_row(view, &module.bytes, &pe, row_index)?);
        }

        Ok(LinearRowsResult { rows })
    }

    fn method_linear_find_row_by_rva(
        &mut self,
        params: Result<LinearFindRowByRvaParams, EngineError>,
    ) -> Result<LinearFindRowByRvaResult, EngineError> {
        let params = params?;
        let module = self
            .modules
            .get_mut(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;

        ensure_linear_view(module)?;
        let view = module
            .linear_view
            .as_ref()
            .ok_or_else(|| EngineError::Internal("Linear view missing".to_owned()))?;

        let target_rva = parse_hex_u64(&params.rva)?;
        let row_index = find_row_by_rva(view, target_rva)?;
        Ok(LinearFindRowByRvaResult { row_index })
    }
}

#[derive(Debug)]
struct RangeSpec {
    start: u64,
    end: u64,
    exec: bool,
}

fn ensure_linear_view(module: &mut ModuleState) -> Result<(), EngineError> {
    if module.linear_view.is_some() {
        return Ok(());
    }

    let pe = parse_pe64(&module.bytes)?;
    let linear_view = build_linear_view(&module.bytes, &pe)?;
    module.linear_view = Some(linear_view);
    Ok(())
}

fn build_linear_view(bytes: &[u8], pe: &PE<'_>) -> Result<LinearView, EngineError> {
    let mut ranges = collect_mapped_ranges(pe);
    if ranges.is_empty() {
        return Err(EngineError::UnsupportedFormat);
    }

    ranges.sort_by_key(|value| value.start);
    let normalized = normalize_ranges(ranges);
    if normalized.is_empty() {
        return Err(EngineError::UnsupportedFormat);
    }

    let mut segments = Vec::new();
    let mut row_cursor = 0u64;
    let mut previous_end = normalized[0].start;

    for range in normalized {
        if previous_end < range.start {
            let gap_len = range.start - previous_end;
            segments.push(LinearSegment {
                start_row: row_cursor,
                row_count: 1,
                start_rva: previous_end,
                end_rva: range.start,
                kind: LinearSegmentKind::Gap,
            });
            row_cursor += 1;
            if gap_len == 0 {
                continue;
            }
        }

        if range.end <= range.start {
            previous_end = range.end;
            continue;
        }

        if range.exec {
            let exec_rows = build_exec_rows(bytes, pe, range.start, range.end)?;
            if exec_rows.is_empty() {
                previous_end = range.end;
                continue;
            }
            let row_count = exec_rows.len() as u64;
            segments.push(LinearSegment {
                start_row: row_cursor,
                row_count,
                start_rva: range.start,
                end_rva: range.end,
                kind: LinearSegmentKind::Exec(ExecSegment { rows: exec_rows }),
            });
            row_cursor += row_count;
        } else {
            let row_count = (range.end - range.start).div_ceil(DATA_GROUP_SIZE);
            segments.push(LinearSegment {
                start_row: row_cursor,
                row_count,
                start_rva: range.start,
                end_rva: range.end,
                kind: LinearSegmentKind::Data,
            });
            row_cursor += row_count;
        }

        previous_end = range.end;
    }

    if segments.is_empty() {
        return Err(EngineError::UnsupportedFormat);
    }

    let min_rva = segments
        .first()
        .map(|value| value.start_rva)
        .unwrap_or_default();
    let max_rva = segments
        .last()
        .map(|value| value.end_rva.saturating_sub(1))
        .unwrap_or_default();

    Ok(LinearView {
        row_count: row_cursor,
        min_rva,
        max_rva,
        segments,
    })
}

fn collect_mapped_ranges(pe: &PE<'_>) -> Vec<RangeSpec> {
    let mut ranges = Vec::new();

    let size_of_headers = pe
        .header
        .optional_header
        .as_ref()
        .map(|value| value.windows_fields.size_of_headers as u64)
        .unwrap_or(0);
    if size_of_headers > 0 {
        ranges.push(RangeSpec {
            start: 0,
            end: size_of_headers,
            exec: false,
        });
    }

    for section in &pe.sections {
        let start = section.virtual_address as u64;
        let len = u64::from(section.virtual_size.max(section.size_of_raw_data));
        let end = start.saturating_add(len);
        if end <= start {
            continue;
        }
        let exec = section.characteristics & IMAGE_SCN_MEM_EXECUTE != 0;
        ranges.push(RangeSpec { start, end, exec });
    }

    ranges
}

fn normalize_ranges(sorted_ranges: Vec<RangeSpec>) -> Vec<RangeSpec> {
    let mut output = Vec::<RangeSpec>::new();
    for range in sorted_ranges {
        if output.is_empty() {
            output.push(range);
            continue;
        }

        let mut trailing: Option<RangeSpec> = None;
        let mut append = false;
        {
            let last = output.last_mut().expect("non-empty");
            if range.start >= last.end {
                append = true;
            } else if range.exec == last.exec {
                if range.end > last.end {
                    last.end = range.end;
                }
            } else if range.end > last.end {
                trailing = Some(RangeSpec {
                    start: last.end,
                    end: range.end,
                    exec: range.exec,
                });
            }
        }

        if append {
            output.push(range);
            continue;
        }
        if let Some(spec) = trailing {
            output.push(spec);
        }
    }
    output
}

fn build_exec_rows(
    bytes: &[u8],
    pe: &PE<'_>,
    start_rva: u64,
    end_rva: u64,
) -> Result<Vec<ExecRowIndex>, EngineError> {
    let mut rows = Vec::<ExecRowIndex>::new();
    let mut rva = start_rva;
    let image_base = pe.image_base as u64;
    let mut invalid_streak = 0usize;

    while rva < end_rva {
        let window_len = usize::try_from((end_rva - rva).min(15))
            .map_err(|error| EngineError::Internal(error.to_string()))?;
        let mut decode_window = Vec::with_capacity(window_len);
        for offset in 0..window_len {
            decode_window.push(get_byte_at_rva(bytes, pe, rva + offset as u64));
        }

        let mut decoder =
            Decoder::with_ip(64, &decode_window, image_base + rva, DecoderOptions::NONE);
        let mut instruction = Instruction::default();
        decoder.decode_out(&mut instruction);

        if instruction.mnemonic() == Mnemonic::INVALID
            || instruction.len() == 0
            || instruction.len() as usize > window_len
        {
            invalid_streak += 1;
            let _ = invalid_streak;
            rows.push(ExecRowIndex {
                rva,
                len: 1,
                decoded: false,
            });
            rva += 1;
            continue;
        }

        invalid_streak = 0;
        let len = instruction.len().min(u8::MAX as usize) as u8;
        rows.push(ExecRowIndex {
            rva,
            len,
            decoded: true,
        });
        rva += u64::from(len);
    }

    Ok(rows)
}

fn find_segment_by_row<'a>(
    view: &'a LinearView,
    row: u64,
) -> Result<&'a LinearSegment, EngineError> {
    let idx = view
        .segments
        .partition_point(|segment| segment.start_row + segment.row_count <= row);
    view.segments.get(idx).ok_or(EngineError::InvalidAddress)
}

fn find_row_by_rva(view: &LinearView, rva: u64) -> Result<u64, EngineError> {
    let segment_index = view
        .segments
        .partition_point(|segment| segment.end_rva <= rva);
    let segment = view
        .segments
        .get(segment_index)
        .ok_or(EngineError::InvalidAddress)?;

    if rva < segment.start_rva || rva >= segment.end_rva {
        return Err(EngineError::InvalidAddress);
    }

    match &segment.kind {
        LinearSegmentKind::Gap => Ok(segment.start_row),
        LinearSegmentKind::Data => {
            let row_offset = (rva - segment.start_rva) / DATA_GROUP_SIZE;
            Ok(segment.start_row + row_offset)
        }
        LinearSegmentKind::Exec(exec) => {
            let index = exec.rows.partition_point(|row| row.rva <= rva);
            if index == 0 {
                return Ok(segment.start_row);
            }
            Ok(segment.start_row + (index as u64 - 1))
        }
    }
}

fn materialize_linear_row(
    view: &LinearView,
    bytes: &[u8],
    pe: &PE<'_>,
    row_index: u64,
) -> Result<LinearViewRow, EngineError> {
    let segment = find_segment_by_row(view, row_index)?;
    let row_offset = row_index.saturating_sub(segment.start_row);

    match &segment.kind {
        LinearSegmentKind::Gap => {
            let gap_size = segment.end_rva.saturating_sub(segment.start_rva);
            Ok(LinearViewRow {
                kind: "gap",
                address: to_hex(segment.start_rva),
                bytes: String::new(),
                mnemonic: "<gap>".to_owned(),
                operands: String::new(),
                branch_target: None,
                call_target: None,
                comment: Some(format!(
                    "unmapped to {} ({} bytes)",
                    to_hex(segment.end_rva),
                    gap_size
                )),
            })
        }
        LinearSegmentKind::Data => {
            let rva = segment.start_rva + row_offset * DATA_GROUP_SIZE;
            let remaining = segment.end_rva.saturating_sub(rva);
            let count = remaining.min(DATA_GROUP_SIZE);
            let mut byte_values = Vec::new();
            for index in 0..count {
                byte_values.push(get_byte_at_rva(bytes, pe, rva + index));
            }
            let bytes_text = bytes_to_hex(&byte_values);
            let operands = byte_values
                .iter()
                .map(|value| format!("0x{value:02X}"))
                .collect::<Vec<String>>()
                .join(", ");

            Ok(LinearViewRow {
                kind: "data",
                address: to_hex(rva),
                bytes: bytes_text,
                mnemonic: "db".to_owned(),
                operands,
                branch_target: None,
                call_target: None,
                comment: None,
            })
        }
        LinearSegmentKind::Exec(exec) => {
            let exec_row = exec
                .rows
                .get(row_offset as usize)
                .ok_or_else(|| EngineError::Internal("Invalid exec row offset".to_owned()))?;
            if !exec_row.decoded {
                let value = get_byte_at_rva(bytes, pe, exec_row.rva);
                return Ok(LinearViewRow {
                    kind: "data",
                    address: to_hex(exec_row.rva),
                    bytes: format!("{value:02X}"),
                    mnemonic: "db".to_owned(),
                    operands: format!("0x{value:02X}"),
                    branch_target: None,
                    call_target: None,
                    comment: Some("invalid decode fallback".to_owned()),
                });
            }

            let window_len = usize::try_from((segment.end_rva - exec_row.rva).min(15))
                .map_err(|error| EngineError::Internal(error.to_string()))?;
            let mut decode_window = Vec::with_capacity(window_len);
            for offset in 0..window_len {
                decode_window.push(get_byte_at_rva(bytes, pe, exec_row.rva + offset as u64));
            }

            let image_base = pe.image_base as u64;
            let mut decoder = Decoder::with_ip(
                64,
                &decode_window,
                image_base + exec_row.rva,
                DecoderOptions::NONE,
            );
            let mut instruction = Instruction::default();
            decoder.decode_out(&mut instruction);

            if instruction.mnemonic() == Mnemonic::INVALID || instruction.len() == 0 {
                let value = get_byte_at_rva(bytes, pe, exec_row.rva);
                return Ok(LinearViewRow {
                    kind: "data",
                    address: to_hex(exec_row.rva),
                    bytes: format!("{value:02X}"),
                    mnemonic: "db".to_owned(),
                    operands: format!("0x{value:02X}"),
                    branch_target: None,
                    call_target: None,
                    comment: Some("invalid decode fallback".to_owned()),
                });
            }

            let mut formatter = GasFormatter::new();
            let mut instruction_text = String::new();
            formatter.format(&instruction, &mut instruction_text);
            let (mnemonic, operands) = split_instruction_text(&instruction_text);
            let len = usize::from(exec_row.len);
            let bytes_text = bytes_to_hex(&decode_window[0..len.min(decode_window.len())]);

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

            Ok(LinearViewRow {
                kind: "instruction",
                address: to_hex(exec_row.rva),
                bytes: bytes_text,
                mnemonic,
                operands,
                branch_target,
                call_target,
                comment: None,
            })
        }
    }
}

fn get_byte_at_rva(bytes: &[u8], pe: &PE<'_>, rva: u64) -> u8 {
    let size_of_headers = pe
        .header
        .optional_header
        .as_ref()
        .map(|value| value.windows_fields.size_of_headers as u64)
        .unwrap_or(0);
    if rva < size_of_headers {
        let offset = rva as usize;
        return bytes.get(offset).copied().unwrap_or(0);
    }

    for section in &pe.sections {
        let start = section.virtual_address as u64;
        let len = u64::from(section.virtual_size.max(section.size_of_raw_data));
        let end = start.saturating_add(len);
        if rva < start || rva >= end {
            continue;
        }

        let section_offset = rva.saturating_sub(start);
        if section_offset < section.size_of_raw_data as u64 {
            let file_offset = section.pointer_to_raw_data as u64 + section_offset;
            return bytes.get(file_offset as usize).copied().unwrap_or(0);
        }
        return 0;
    }

    0
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

fn collect_exception_function_starts(pe: &PE<'_>) -> Vec<u64> {
    let Some(exception_data) = pe.exception_data.as_ref() else {
        return Vec::new();
    };

    let entries = exception_data
        .functions()
        .filter_map(Result::ok)
        .collect::<Vec<RuntimeFunction>>();

    collect_exception_function_starts_from_entries(&entries, |rva| is_executable_rva(pe, rva))
}

fn collect_exception_function_starts_from_entries<F>(
    entries: &[RuntimeFunction],
    mut is_executable_start: F,
) -> Vec<u64>
where
    F: FnMut(u64) -> bool,
{
    let mut starts = Vec::new();

    for entry in entries {
        let start = u64::from(entry.begin_address);
        let end = u64::from(entry.end_address);
        if !is_valid_exception_function_range(start, end) {
            continue;
        }
        if !is_executable_start(start) {
            continue;
        }

        starts.push(start);
    }

    starts
}

fn is_valid_exception_function_range(start: u64, end: u64) -> bool {
    start != 0 && end > start
}

fn is_executable_rva(pe: &PE<'_>, rva: u64) -> bool {
    for section in &pe.sections {
        let start = section.virtual_address as u64;
        let len = u64::from(section.virtual_size.max(section.size_of_raw_data));
        let end = start.saturating_add(len);
        if rva < start || rva >= end {
            continue;
        }

        return section.characteristics & IMAGE_SCN_MEM_EXECUTE != 0;
    }

    false
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
    use goblin::pe::exception::RuntimeFunction;

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

    #[test]
    fn validates_exception_function_ranges() {
        assert!(!is_valid_exception_function_range(0, 0x1100));
        assert!(!is_valid_exception_function_range(0x1200, 0x1200));
        assert!(!is_valid_exception_function_range(0x1300, 0x1200));
        assert!(is_valid_exception_function_range(0x1400, 0x1410));
    }

    #[test]
    fn collects_exception_starts_with_exec_filtering() {
        let entries = vec![
            RuntimeFunction {
                begin_address: 0,
                end_address: 0x1100,
                unwind_info_address: 0,
            },
            RuntimeFunction {
                begin_address: 0x1200,
                end_address: 0x1200,
                unwind_info_address: 0,
            },
            RuntimeFunction {
                begin_address: 0x1300,
                end_address: 0x1310,
                unwind_info_address: 0,
            },
            RuntimeFunction {
                begin_address: 0x1400,
                end_address: 0x1420,
                unwind_info_address: 0,
            },
        ];

        let starts = collect_exception_function_starts_from_entries(&entries, |rva| rva == 0x1400);
        assert_eq!(starts, vec![0x1400]);
    }
}
