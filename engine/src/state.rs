use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::analysis::{ModuleAnalysis, build_module_analysis};
use crate::disasm::{parse_hex_u64, to_hex};
use crate::error::EngineError;
use crate::linear::{
    DATA_GROUP_SIZE, LINEAR_ROW_HEIGHT, MAX_LINEAR_PAGE_ROWS, find_row_by_rva,
    materialize_linear_row,
};
use crate::pe_utils::parse_pe64;
use crate::protocol::{
    EnginePingParams, EnginePingResult, ExportInfo, FunctionGraphByVaParams,
    FunctionGraphByVaResult, FunctionListParams, FunctionListResult, FunctionSeed, ImportInfo,
    InstructionRow, LinearDisassemblyParams, LinearDisassemblyResult, LinearFindRowByVaParams,
    LinearFindRowByVaResult, LinearRowsParams, LinearRowsResult, LinearViewInfoParams,
    LinearViewInfoResult, ModuleInfoParams, ModuleInfoResult, ModuleOpenParams, ModuleOpenResult,
    SectionInfo,
};
use crate::rpc::{RpcRequest, RpcResponse, is_valid_request_id, rpc_error};

const DEFAULT_MAX_INSTRUCTIONS: usize = 512;
const MAX_MAX_INSTRUCTIONS: usize = 4096;

#[derive(Debug)]
struct ModuleState {
    path: PathBuf,
    bytes: Vec<u8>,
    analysis: Option<ModuleAnalysis>,
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
                analysis: None,
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
        ensure_module_analysis(module)?;
        let analysis = module
            .analysis
            .as_ref()
            .ok_or_else(|| EngineError::Internal("Analysis cache missing".to_owned()))?;
        let image_base = parse_pe64(&module.bytes)?.image_base as u64;

        Ok(FunctionListResult {
            functions: analysis
                .functions
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
        ensure_module_analysis(module)?;
        let analysis = module
            .analysis
            .as_ref()
            .ok_or_else(|| EngineError::Internal("Analysis cache missing".to_owned()))?;
        let image_base = parse_pe64(&module.bytes)?.image_base as u64;
        let target_va = parse_hex_u64(&params.va)?;
        if target_va < image_base {
            return Err(EngineError::InvalidAddress);
        }
        let target_rva = target_va - image_base;
        let owner_start_rva = analysis
            .instruction_owner_by_rva
            .get(&target_rva)
            .copied()
            .ok_or(EngineError::InvalidAddress)?;
        let graph = analysis
            .graphs_by_start
            .get(&owner_start_rva)
            .ok_or(EngineError::InvalidAddress)?;
        let focus_block_id = graph
            .instruction_block_id_by_rva
            .get(&target_rva)
            .cloned()
            .ok_or(EngineError::InvalidAddress)?;

        Ok(FunctionGraphByVaResult {
            function_start_va: to_hex(image_base + graph.function_start_rva),
            function_name: graph.function_name.clone(),
            focus_block_id,
            blocks: graph.blocks.clone(),
            edges: graph.edges.clone(),
        })
    }

    fn method_disassemble_linear(
        &mut self,
        params: Result<LinearDisassemblyParams, EngineError>,
    ) -> Result<LinearDisassemblyResult, EngineError> {
        let params = params?;
        let module = self
            .modules
            .get_mut(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;
        ensure_module_analysis(module)?;
        let analysis = module
            .analysis
            .as_ref()
            .ok_or_else(|| EngineError::Internal("Analysis cache missing".to_owned()))?;
        let image_base = parse_pe64(&module.bytes)?.image_base as u64;
        let start_va = parse_hex_u64(&params.start)?;
        if start_va < image_base {
            return Err(EngineError::InvalidAddress);
        }
        let start_rva = start_va - image_base;
        let owner_start_rva = analysis
            .instruction_owner_by_rva
            .get(&start_rva)
            .copied()
            .ok_or(EngineError::InvalidAddress)?;
        let function_rows = analysis
            .claimed_instructions_by_function_start
            .get(&owner_start_rva)
            .ok_or(EngineError::InvalidAddress)?;
        let start_index = find_instruction_index(function_rows, start_rva)?;

        let max_instructions = params
            .max_instructions
            .unwrap_or(DEFAULT_MAX_INSTRUCTIONS)
            .min(MAX_MAX_INSTRUCTIONS);

        let mut instructions = Vec::new();
        for row in function_rows
            .iter()
            .skip(start_index)
            .take(max_instructions)
        {
            instructions.push(InstructionRow {
                address: to_hex(image_base + row.start_rva),
                bytes: row.bytes.clone(),
                mnemonic: row.mnemonic.clone(),
                operands: row.operands.clone(),
                instruction_category: row.instruction_category,
                branch_target: row
                    .branch_target_rva
                    .map(|target| to_hex(image_base + target)),
                call_target: row
                    .call_target_rva
                    .map(|target| to_hex(image_base + target)),
            });
        }

        let stop_reason = if instructions.len() >= max_instructions {
            "max_instructions"
        } else if function_rows.last().is_some_and(|row| {
            row.instruction_category == crate::protocol::InstructionCategory::Return
        }) {
            "ret"
        } else {
            "end_of_data"
        };

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
        ensure_module_analysis(module)?;
        let analysis = module
            .analysis
            .as_ref()
            .ok_or_else(|| EngineError::Internal("Analysis cache missing".to_owned()))?;
        let image_base = parse_pe64(&module.bytes)?.image_base as u64;

        Ok(LinearViewInfoResult {
            row_count: analysis.linear_view.row_count,
            min_va: to_hex(image_base + analysis.linear_view.min_rva),
            max_va: to_hex(image_base + analysis.linear_view.max_rva),
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
        ensure_module_analysis(module)?;
        let analysis = module
            .analysis
            .as_ref()
            .ok_or_else(|| EngineError::Internal("Analysis cache missing".to_owned()))?;
        let pe = parse_pe64(&module.bytes)?;
        let image_base = pe.image_base as u64;

        let requested = params.row_count.min(MAX_LINEAR_PAGE_ROWS as u64) as usize;
        let start_row = params.start_row.min(analysis.linear_view.row_count);
        let end_row = (start_row + requested as u64).min(analysis.linear_view.row_count);

        let mut rows = Vec::with_capacity(requested);
        for row_index in start_row..end_row {
            rows.push(materialize_linear_row(
                &analysis.linear_view,
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
        ensure_module_analysis(module)?;
        let analysis = module
            .analysis
            .as_ref()
            .ok_or_else(|| EngineError::Internal("Analysis cache missing".to_owned()))?;
        let image_base = parse_pe64(&module.bytes)?.image_base as u64;
        let target_va = parse_hex_u64(&params.va)?;
        if target_va < image_base {
            return Err(EngineError::InvalidAddress);
        }
        let target_rva = target_va - image_base;
        let row_index = find_row_by_rva(&analysis.linear_view, target_rva)?;
        Ok(LinearFindRowByVaResult { row_index })
    }
}

fn ensure_module_analysis(module: &mut ModuleState) -> Result<(), EngineError> {
    if module.analysis.is_some() {
        return Ok(());
    }

    module.analysis = Some(build_module_analysis(&module.path, &module.bytes)?);
    Ok(())
}

fn find_instruction_index(
    rows: &[crate::linear::AnalyzedInstructionRow],
    start_rva: u64,
) -> Result<usize, EngineError> {
    let index = rows.partition_point(|row| row.start_rva <= start_rva);
    if index == 0 {
        return Err(EngineError::InvalidAddress);
    }
    let row = &rows[index - 1];
    if start_rva >= row.start_rva && start_rva < row.start_rva + u64::from(row.len) {
        return Ok(index - 1);
    }
    Err(EngineError::InvalidAddress)
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
