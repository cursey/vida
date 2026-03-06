use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

use iced_x86::{
    Decoder, DecoderOptions, FlowControl, Formatter, Instruction, IntelFormatter, Mnemonic,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::cfg::{BasicBlockEdgeKind, FunctionGraphAnalysis, analyze_function_cfg};
use crate::disasm::{
    bytes_to_hex, categorize_instruction, default_function_name, parse_hex_u64,
    split_instruction_text, to_hex,
};
use crate::error::EngineError;
use crate::linear::{
    DATA_GROUP_SIZE, LINEAR_ROW_HEIGHT, LinearView, MAX_LINEAR_PAGE_ROWS, build_linear_view,
    find_row_by_rva, materialize_linear_row,
};
use crate::pdb_symbols::discover_pdb_function_seeds;
use crate::pe_utils::{collect_exception_function_starts, find_section_for_rva, parse_pe64};
use crate::protocol::{
    EnginePingParams, EnginePingResult, ExportInfo, FunctionGraphBlock, FunctionGraphByVaParams,
    FunctionGraphByVaResult, FunctionGraphEdge, FunctionGraphInstruction, FunctionListParams,
    FunctionListResult, FunctionSeed, ImportInfo, InstructionRow, LinearDisassemblyParams,
    LinearDisassemblyResult, LinearFindRowByVaParams, LinearFindRowByVaResult, LinearRowsParams,
    LinearRowsResult, LinearViewInfoParams, LinearViewInfoResult, ModuleInfoParams,
    ModuleInfoResult, ModuleOpenParams, ModuleOpenResult, SectionInfo,
};
use crate::rpc::{RpcRequest, RpcResponse, is_valid_request_id, rpc_error};

const INVALID_STREAK_LIMIT: usize = 3;
const DEFAULT_MAX_INSTRUCTIONS: usize = 512;
const MAX_MAX_INSTRUCTIONS: usize = 4096;

#[derive(Debug)]
struct ModuleState {
    path: PathBuf,
    bytes: Vec<u8>,
    linear_view: Option<LinearView>,
    function_seeds: Option<Vec<FunctionSeedEntry>>,
    function_graph_cache: HashMap<u64, CachedFunctionGraph>,
    instruction_owner_cache: HashMap<u64, u64>,
}

#[derive(Debug, Clone)]
struct FunctionSeedEntry {
    start_rva: u64,
    name: String,
    kind: &'static str,
}

#[derive(Debug, Clone)]
struct CachedFunctionGraph {
    function_start_rva: u64,
    function_name: String,
    blocks: Vec<FunctionGraphBlock>,
    edges: Vec<FunctionGraphEdge>,
    instruction_starts: HashSet<u64>,
    instruction_block_id_by_rva: HashMap<u64, String>,
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
            "function.getGraphByVa" => self
                .method_function_get_graph_by_va(parse_params::<FunctionGraphByVaParams>(
                    request.params,
                ))
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
            "linear.findRowByVa" => self
                .method_linear_find_row_by_va(parse_params::<LinearFindRowByVaParams>(
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
        let entry_va = image_base + entry_rva;

        self.next_module_id += 1;
        let module_id = format!("m{}", self.next_module_id);

        self.modules.insert(
            module_id.clone(),
            ModuleState {
                path,
                bytes,
                linear_view: None,
                function_seeds: None,
                function_graph_cache: HashMap::new(),
                instruction_owner_cache: HashMap::new(),
            },
        );

        Ok(ModuleOpenResult {
            module_id,
            arch: "x64",
            image_base: to_hex(image_base),
            entry_va: to_hex(entry_va),
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
        let image_base = pe.image_base as u64;

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
                start_va: to_hex(image_base + start_rva),
                end_va: to_hex(image_base + end_rva),
                raw_offset: section.pointer_to_raw_data as usize,
                raw_size: section.size_of_raw_data as usize,
            });
        }

        let mut imports = Vec::new();
        for import in &pe.imports {
            imports.push(ImportInfo {
                library: import.dll.to_owned(),
                name: import.name.to_string(),
                address_va: to_hex(image_base + import.rva as u64),
            });
        }

        let mut exports = Vec::new();
        for export in &pe.exports {
            exports.push(ExportInfo {
                name: export.name.unwrap_or("<unnamed>").to_owned(),
                start: to_hex(image_base + export.rva as u64),
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
            .get_mut(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;
        let image_base = parse_pe64(&module.bytes)?.image_base as u64;

        ensure_function_seeds(module, image_base)?;
        let seeds = module
            .function_seeds
            .as_ref()
            .ok_or_else(|| EngineError::Internal("Function seed cache missing".to_owned()))?;

        Ok(FunctionListResult {
            functions: seeds
                .iter()
                .map(|seed| FunctionSeed {
                    start: to_hex(image_base + seed.start_rva),
                    name: seed.name.clone(),
                    kind: seed.kind,
                })
                .collect(),
        })
    }

    fn method_function_get_graph_by_va(
        &mut self,
        params: Result<FunctionGraphByVaParams, EngineError>,
    ) -> Result<FunctionGraphByVaResult, EngineError> {
        let params = params?;
        let module = self
            .modules
            .get_mut(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;
        let image_base = parse_pe64(&module.bytes)?.image_base as u64;
        let target_va = parse_hex_u64(&params.va)?;
        if target_va < image_base {
            return Err(EngineError::InvalidAddress);
        }
        let target_rva = target_va - image_base;

        ensure_function_seeds(module, image_base)?;
        let pe = parse_pe64(&module.bytes)?;

        if let Some(owner_start_rva) = module.instruction_owner_cache.get(&target_rva).copied() {
            if let Some(graph) = module.function_graph_cache.get(&owner_start_rva) {
                let focus_block_id = graph
                    .instruction_block_id_by_rva
                    .get(&target_rva)
                    .cloned()
                    .ok_or(EngineError::InvalidAddress)?;
                return Ok(FunctionGraphByVaResult {
                    function_start_va: to_hex(image_base + graph.function_start_rva),
                    function_name: graph.function_name.clone(),
                    focus_block_id,
                    blocks: graph.blocks.clone(),
                    edges: graph.edges.clone(),
                });
            }
        }

        let seeds = module
            .function_seeds
            .as_ref()
            .ok_or_else(|| EngineError::Internal("Function seed cache missing".to_owned()))?
            .clone();

        for seed in seeds {
            if !module.function_graph_cache.contains_key(&seed.start_rva) {
                match analyze_function_cfg(&module.bytes, &pe, seed.start_rva) {
                    Ok(analysis) => {
                        let cached =
                            build_cached_function_graph(analysis, image_base, seed.name.clone());
                        for instruction_rva in &cached.instruction_starts {
                            module
                                .instruction_owner_cache
                                .entry(*instruction_rva)
                                .or_insert(seed.start_rva);
                        }
                        module.function_graph_cache.insert(seed.start_rva, cached);
                    }
                    Err(EngineError::InvalidAddress) => continue,
                    Err(error) => return Err(error),
                }
            }

            if module.instruction_owner_cache.get(&target_rva) == Some(&seed.start_rva)
                && let Some(graph) = module.function_graph_cache.get(&seed.start_rva)
            {
                let focus_block_id = graph
                    .instruction_block_id_by_rva
                    .get(&target_rva)
                    .cloned()
                    .ok_or(EngineError::InvalidAddress)?;
                return Ok(FunctionGraphByVaResult {
                    function_start_va: to_hex(image_base + graph.function_start_rva),
                    function_name: graph.function_name.clone(),
                    focus_block_id,
                    blocks: graph.blocks.clone(),
                    edges: graph.edges.clone(),
                });
            }
        }

        Err(EngineError::InvalidAddress)
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
        let image_base = pe.image_base as u64;

        let start_va = parse_hex_u64(&params.start)?;
        if start_va < image_base {
            return Err(EngineError::InvalidAddress);
        }
        let start_rva = start_va - image_base;
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

        let mut decoder = Decoder::with_ip(
            64,
            decode_slice,
            image_base + start_rva,
            DecoderOptions::NONE,
        );
        let mut formatter = IntelFormatter::new();

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
            let instruction_category = categorize_instruction(&instruction, &mnemonic);

            let branch_target = match instruction.flow_control() {
                FlowControl::ConditionalBranch | FlowControl::UnconditionalBranch => {
                    Some(to_hex(instruction.near_branch_target()))
                }
                _ => None,
            };

            let call_target = match instruction.flow_control() {
                FlowControl::Call => Some(to_hex(instruction.near_branch_target())),
                _ => None,
            };

            instructions.push(InstructionRow {
                address: to_hex(current_va),
                bytes: bytes_to_hex(encoded_bytes),
                mnemonic,
                operands,
                instruction_category,
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
        let pe = parse_pe64(&module.bytes)?;
        let image_base = pe.image_base as u64;

        Ok(LinearViewInfoResult {
            row_count: view.row_count,
            min_va: to_hex(image_base + view.min_rva),
            max_va: to_hex(image_base + view.max_rva),
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
        let image_base = pe.image_base as u64;

        let requested = params.row_count.min(MAX_LINEAR_PAGE_ROWS as u64) as usize;
        let start_row = params.start_row.min(view.row_count);
        let end_row = (start_row + requested as u64).min(view.row_count);

        let mut rows = Vec::with_capacity(requested);
        for row_index in start_row..end_row {
            rows.push(materialize_linear_row(
                view,
                &module.bytes,
                &pe,
                image_base,
                row_index,
            )?);
        }

        Ok(LinearRowsResult { rows })
    }

    fn method_linear_find_row_by_va(
        &mut self,
        params: Result<LinearFindRowByVaParams, EngineError>,
    ) -> Result<LinearFindRowByVaResult, EngineError> {
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
        let image_base = pe.image_base as u64;
        let target_va = parse_hex_u64(&params.va)?;
        if target_va < image_base {
            return Err(EngineError::InvalidAddress);
        }
        let target_rva = target_va - image_base;
        let row_index = find_row_by_rva(view, target_rva)?;
        Ok(LinearFindRowByVaResult { row_index })
    }
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

fn ensure_function_seeds(module: &mut ModuleState, image_base: u64) -> Result<(), EngineError> {
    if module.function_seeds.is_some() {
        return Ok(());
    }

    let seeds = {
        let pe = parse_pe64(&module.bytes)?;
        let mut ordered = BTreeMap::<u64, FunctionSeedEntry>::new();
        let entry_rva = pe.entry as u64;
        ordered.insert(
            entry_rva,
            FunctionSeedEntry {
                start_rva: entry_rva,
                name: default_function_name(image_base + entry_rva),
                kind: "entry",
            },
        );

        for export in &pe.exports {
            let rva = export.rva as u64;
            ordered.entry(rva).or_insert_with(|| FunctionSeedEntry {
                start_rva: rva,
                name: default_function_name(image_base + rva),
                kind: "export",
            });
        }

        for rva in collect_exception_function_starts(&pe) {
            ordered.entry(rva).or_insert_with(|| FunctionSeedEntry {
                start_rva: rva,
                name: default_function_name(image_base + rva),
                kind: "exception",
            });
        }

        for pdb_function in discover_pdb_function_seeds(&module.path, &pe) {
            let rva = pdb_function.start_rva;
            ordered.insert(
                rva,
                FunctionSeedEntry {
                    start_rva: rva,
                    name: pdb_function.name,
                    kind: "pdb",
                },
            );
        }

        ordered.into_values().collect::<Vec<FunctionSeedEntry>>()
    };

    module.function_seeds = Some(seeds);
    Ok(())
}

fn build_cached_function_graph(
    analysis: FunctionGraphAnalysis,
    image_base: u64,
    function_name: String,
) -> CachedFunctionGraph {
    let block_id_by_start_rva = analysis
        .blocks
        .iter()
        .map(|block| (block.start_rva, format!("b_{:X}", block.start_rva)))
        .collect::<HashMap<u64, String>>();

    let mut instruction_block_id_by_rva = HashMap::<u64, String>::new();
    let blocks = analysis
        .blocks
        .iter()
        .map(|block| {
            let block_id = block_id_by_start_rva
                .get(&block.start_rva)
                .cloned()
                .unwrap_or_else(|| format!("b_{:X}", block.start_rva));

            let instructions = block
                .instructions
                .iter()
                .map(|instruction| {
                    instruction_block_id_by_rva.insert(instruction.start_rva, block_id.clone());
                    FunctionGraphInstruction {
                        mnemonic: instruction.mnemonic.clone(),
                        operands: instruction.operands.clone(),
                        instruction_category: instruction.instruction_category,
                    }
                })
                .collect();

            FunctionGraphBlock {
                id: block_id,
                start_va: to_hex(image_base + block.start_rva),
                instructions,
            }
        })
        .collect::<Vec<FunctionGraphBlock>>();

    let edges = analysis
        .edges
        .iter()
        .filter_map(|edge| {
            let from_block_id = block_id_by_start_rva.get(&edge.from_rva)?;
            let to_block_id = block_id_by_start_rva.get(&edge.to_rva)?;
            Some(FunctionGraphEdge {
                from_block_id: from_block_id.clone(),
                to_block_id: to_block_id.clone(),
                kind: match edge.kind {
                    BasicBlockEdgeKind::Conditional => "conditional",
                    BasicBlockEdgeKind::Unconditional => "unconditional",
                    BasicBlockEdgeKind::Fallthrough => "fallthrough",
                },
            })
        })
        .collect::<Vec<FunctionGraphEdge>>();

    CachedFunctionGraph {
        function_start_rva: analysis.start_rva,
        function_name,
        blocks,
        edges,
        instruction_starts: analysis.instruction_starts,
        instruction_block_id_by_rva,
    }
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
