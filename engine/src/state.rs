use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::thread;

use crate::analysis::{
    AnalysisProgressPhase, AnalysisProgressUpdate, FunctionSeedEntry, ModuleAnalysis,
    build_module_analysis_with_progress,
};
use crate::api::{
    EnginePingParams, EnginePingResult, ExportInfo, FunctionGraphByVaParams,
    FunctionGraphByVaResult, FunctionListParams, FunctionListResult, FunctionSeed, ImportInfo,
    InstructionCategory, InstructionRow, LinearDisassemblyParams, LinearDisassemblyResult,
    LinearFindRowByVaParams, LinearFindRowByVaResult, LinearRowsParams, LinearRowsResult,
    LinearViewInfoParams, LinearViewInfoResult, ModuleAnalysisStatusParams,
    ModuleAnalysisStatusResult, ModuleInfoParams, ModuleInfoResult, ModuleOpenParams,
    ModuleOpenResult, ModuleUnloadParams, ModuleUnloadResult, SectionInfo,
};
use crate::disasm::{parse_hex_u64, to_hex};
use crate::error::EngineError;
use crate::linear::{
    DATA_GROUP_SIZE, LINEAR_ROW_HEIGHT, MAX_LINEAR_PAGE_ROWS, find_row_by_rva,
    materialize_linear_row,
};
use crate::pe_utils::{SectionLookup, build_section_lookup, parse_pe64};
const DEFAULT_MAX_INSTRUCTIONS: usize = 512;
const MAX_MAX_INSTRUCTIONS: usize = 4096;

#[derive(Debug)]
struct ModuleState {
    bytes: Arc<Vec<u8>>,
    image_base: u64,
    section_lookup: SectionLookup,
    analysis_task: BackgroundAnalysisHandle,
}

#[derive(Debug, Clone)]
struct BackgroundAnalysisHandle {
    shared: Arc<Mutex<BackgroundAnalysisState>>,
    cancel: Arc<AtomicBool>,
}

#[derive(Debug)]
struct BackgroundAnalysisState {
    lifecycle_state: AnalysisLifecycleState,
    message: String,
    discovered_functions: Arc<Vec<FunctionSeedEntry>>,
    total_function_count: Option<usize>,
    analyzed_function_count: Option<usize>,
    analysis: Option<ModuleAnalysis>,
    failure_message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AnalysisLifecycleState {
    Queued,
    DiscoveringFunctions,
    AnalyzingFunctions,
    FinalizingLinearView,
    Ready,
    Failed,
    Canceled,
}

impl AnalysisLifecycleState {
    fn state_name(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::DiscoveringFunctions => "discovering_functions",
            Self::AnalyzingFunctions => "analyzing_functions",
            Self::FinalizingLinearView => "finalizing_linear_view",
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Canceled => "canceled",
        }
    }
}

impl BackgroundAnalysisState {
    fn queued() -> Self {
        Self {
            lifecycle_state: AnalysisLifecycleState::Queued,
            message: "Queued analysis...".to_owned(),
            discovered_functions: Arc::new(Vec::new()),
            total_function_count: None,
            analyzed_function_count: None,
            analysis: None,
            failure_message: None,
        }
    }

    fn update_progress(&mut self, progress: AnalysisProgressUpdate) {
        self.lifecycle_state = match progress.phase {
            AnalysisProgressPhase::DiscoveringFunctions => {
                AnalysisLifecycleState::DiscoveringFunctions
            }
            AnalysisProgressPhase::AnalyzingFunctions => AnalysisLifecycleState::AnalyzingFunctions,
            AnalysisProgressPhase::FinalizingLinearView => {
                AnalysisLifecycleState::FinalizingLinearView
            }
        };
        self.message = progress.phase.message(
            progress.discovered_functions.len(),
            progress.analyzed_function_count,
            progress.total_function_count,
        );
        self.discovered_functions = progress.discovered_functions;
        self.total_function_count = progress.total_function_count;
        self.analyzed_function_count = progress.analyzed_function_count;
        self.failure_message = None;
    }

    fn mark_ready(&mut self, analysis: ModuleAnalysis) {
        self.lifecycle_state = AnalysisLifecycleState::Ready;
        self.message = "Analysis ready.".to_owned();
        self.total_function_count = Some(analysis.functions.len());
        self.analyzed_function_count = Some(analysis.functions.len());
        self.discovered_functions = Arc::new(analysis.functions.clone());
        self.analysis = Some(analysis);
        self.failure_message = None;
    }

    fn mark_failed(&mut self, message: String) {
        self.lifecycle_state = AnalysisLifecycleState::Failed;
        self.message = format!("Analysis failed: {message}");
        self.failure_message = Some(message);
        self.analysis = None;
    }

    fn mark_canceled(&mut self) {
        self.lifecycle_state = AnalysisLifecycleState::Canceled;
        self.message = "Analysis canceled.".to_owned();
        self.analysis = None;
        self.failure_message = None;
    }
}

#[derive(Debug, Default)]
pub struct EngineState {
    next_module_id: usize,
    modules: HashMap<String, ModuleState>,
}

impl EngineState {
    pub fn ping(&mut self, _params: EnginePingParams) -> Result<EnginePingResult, EngineError> {
        Ok(EnginePingResult {
            version: env!("CARGO_PKG_VERSION").to_owned(),
        })
    }

    pub fn open_module(
        &mut self,
        params: ModuleOpenParams,
    ) -> Result<ModuleOpenResult, EngineError> {
        let path = PathBuf::from(params.path);
        let bytes = Arc::new(fs::read(&path).map_err(|error| EngineError::Io(error.to_string()))?);
        let pe = parse_pe64(bytes.as_slice())?;
        let section_lookup = build_section_lookup(&pe);
        let image_base = pe.image_base as u64;
        let entry_rva = pe.entry as u64;
        let entry_va = image_base + entry_rva;

        self.next_module_id += 1;
        let module_id = format!("m{}", self.next_module_id);
        let analysis_task = spawn_background_analysis(path.clone(), Arc::clone(&bytes));

        self.modules.insert(
            module_id.clone(),
            ModuleState {
                bytes,
                image_base,
                section_lookup,
                analysis_task,
            },
        );

        Ok(ModuleOpenResult {
            module_id,
            arch: "x64",
            image_base: to_hex(image_base),
            entry_va: to_hex(entry_va),
        })
    }

    pub fn unload_module(
        &mut self,
        params: ModuleUnloadParams,
    ) -> Result<ModuleUnloadResult, EngineError> {
        let module = self
            .modules
            .remove(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;
        module.analysis_task.cancel.store(true, Ordering::Relaxed);
        Ok(ModuleUnloadResult {})
    }

    pub fn get_module_analysis_status(
        &mut self,
        params: ModuleAnalysisStatusParams,
    ) -> Result<ModuleAnalysisStatusResult, EngineError> {
        let module = self
            .modules
            .get(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;
        let snapshot = module.analysis_task.lock_state()?;
        Ok(ModuleAnalysisStatusResult {
            state: snapshot.lifecycle_state.state_name(),
            message: snapshot.message.clone(),
            discovered_function_count: snapshot.discovered_functions.len(),
            total_function_count: snapshot.total_function_count,
            analyzed_function_count: snapshot.analyzed_function_count,
        })
    }

    pub fn get_module_info(
        &mut self,
        params: ModuleInfoParams,
    ) -> Result<ModuleInfoResult, EngineError> {
        let module = self
            .modules
            .get(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;
        let pe = parse_pe64(module.bytes.as_slice())?;
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

    pub fn list_functions(
        &mut self,
        params: FunctionListParams,
    ) -> Result<FunctionListResult, EngineError> {
        let module = self
            .modules
            .get(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;
        let snapshot = module.analysis_task.lock_state()?;
        let image_base = module.image_base;

        Ok(FunctionListResult {
            functions: snapshot
                .discovered_functions
                .iter()
                .map(|seed| FunctionSeed {
                    start: to_hex(image_base + seed.start_rva),
                    name: seed.name.clone(),
                    kind: seed.kind,
                })
                .collect(),
        })
    }

    pub fn get_function_graph_by_va(
        &mut self,
        params: FunctionGraphByVaParams,
    ) -> Result<FunctionGraphByVaResult, EngineError> {
        let module = self
            .modules
            .get(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;
        let snapshot = module.analysis_task.lock_state()?;
        let analysis = ready_analysis(&snapshot)?;
        let image_base = module.image_base;
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

    pub fn disassemble_linear(
        &mut self,
        params: LinearDisassemblyParams,
    ) -> Result<LinearDisassemblyResult, EngineError> {
        let module = self
            .modules
            .get(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;
        let snapshot = module.analysis_task.lock_state()?;
        let analysis = ready_analysis(&snapshot)?;
        let image_base = module.image_base;
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
        } else if function_rows
            .last()
            .is_some_and(|row| row.instruction_category == InstructionCategory::Return)
        {
            "ret"
        } else {
            "end_of_data"
        };

        Ok(LinearDisassemblyResult {
            instructions,
            stop_reason,
        })
    }

    pub fn get_linear_view_info(
        &mut self,
        params: LinearViewInfoParams,
    ) -> Result<LinearViewInfoResult, EngineError> {
        let module = self
            .modules
            .get(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;
        let snapshot = module.analysis_task.lock_state()?;
        let analysis = ready_analysis(&snapshot)?;
        let image_base = module.image_base;

        Ok(LinearViewInfoResult {
            row_count: analysis.linear_view.row_count,
            min_va: to_hex(image_base + analysis.linear_view.min_rva),
            max_va: to_hex(image_base + analysis.linear_view.max_rva),
            row_height: LINEAR_ROW_HEIGHT,
            data_group_size: DATA_GROUP_SIZE,
        })
    }

    pub fn get_linear_rows(
        &mut self,
        params: LinearRowsParams,
    ) -> Result<LinearRowsResult, EngineError> {
        let module = self
            .modules
            .get(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;
        let snapshot = module.analysis_task.lock_state()?;
        let analysis = ready_analysis(&snapshot)?;
        let image_base = module.image_base;

        let requested = params.row_count.min(MAX_LINEAR_PAGE_ROWS as u64) as usize;
        let start_row = params.start_row.min(analysis.linear_view.row_count);
        let end_row = (start_row + requested as u64).min(analysis.linear_view.row_count);

        let mut rows = Vec::with_capacity(requested);
        for row_index in start_row..end_row {
            rows.push(materialize_linear_row(
                &analysis.linear_view,
                module.bytes.as_slice(),
                &module.section_lookup,
                image_base,
                row_index,
            )?);
        }

        Ok(LinearRowsResult { rows })
    }

    pub fn find_linear_row_by_va(
        &mut self,
        params: LinearFindRowByVaParams,
    ) -> Result<LinearFindRowByVaResult, EngineError> {
        let module = self
            .modules
            .get(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;
        let snapshot = module.analysis_task.lock_state()?;
        let analysis = ready_analysis(&snapshot)?;
        let image_base = module.image_base;
        let target_va = parse_hex_u64(&params.va)?;
        if target_va < image_base {
            return Err(EngineError::InvalidAddress);
        }
        let target_rva = target_va - image_base;
        let row_index = find_row_by_rva(&analysis.linear_view, target_rva)?;
        Ok(LinearFindRowByVaResult { row_index })
    }
}

impl BackgroundAnalysisHandle {
    fn lock_state(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, BackgroundAnalysisState>, EngineError> {
        self.shared
            .lock()
            .map_err(|_| EngineError::Internal("Background analysis state poisoned".to_owned()))
    }
}

fn spawn_background_analysis(path: PathBuf, bytes: Arc<Vec<u8>>) -> BackgroundAnalysisHandle {
    let shared = Arc::new(Mutex::new(BackgroundAnalysisState::queued()));
    let cancel = Arc::new(AtomicBool::new(false));

    let worker_shared = Arc::clone(&shared);
    let worker_cancel = Arc::clone(&cancel);
    thread::spawn(move || {
        let update_progress = |progress: AnalysisProgressUpdate| {
            if let Ok(mut state) = worker_shared.lock() {
                state.update_progress(progress);
            }
        };

        let result =
            build_module_analysis_with_progress(&path, bytes.as_slice(), update_progress, || {
                worker_cancel.load(Ordering::Relaxed)
            });

        if let Ok(mut state) = worker_shared.lock() {
            match result {
                Ok(_analysis) if worker_cancel.load(Ordering::Relaxed) => state.mark_canceled(),
                Ok(analysis) => state.mark_ready(analysis),
                Err(EngineError::Canceled) => state.mark_canceled(),
                Err(error) => state.mark_failed(error.to_string()),
            }
        }
    });

    BackgroundAnalysisHandle { shared, cancel }
}

fn ready_analysis(snapshot: &BackgroundAnalysisState) -> Result<&ModuleAnalysis, EngineError> {
    match snapshot.lifecycle_state {
        AnalysisLifecycleState::Ready => snapshot
            .analysis
            .as_ref()
            .ok_or_else(|| EngineError::Internal("Analysis ready state missing cache".to_owned())),
        AnalysisLifecycleState::Failed => Err(EngineError::AnalysisFailed(
            snapshot
                .failure_message
                .clone()
                .unwrap_or_else(|| "unknown analysis error".to_owned()),
        )),
        AnalysisLifecycleState::Canceled => Err(EngineError::Canceled),
        _ => Err(EngineError::AnalysisNotReady),
    }
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
