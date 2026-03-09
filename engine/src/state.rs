use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::thread;

use crate::analysis::{
    AnalysisProgressPhase, AnalysisProgressUpdate, FunctionSeedEntry, InstructionOwnerRange,
    ModuleAnalysis, build_module_analysis_with_progress, instruction_owner_for_rva,
};
use crate::api::{
    ExportInfo, FunctionGraphByVaParams, FunctionGraphByVaResult, FunctionListParams,
    FunctionListResult, FunctionSeed, ImportInfo, InstructionCategory, InstructionRow,
    LinearDisassemblyParams, LinearDisassemblyResult, LinearFindRowByVaParams,
    LinearFindRowByVaResult, LinearRowsParams, LinearRowsResult, LinearViewInfoParams,
    LinearViewInfoResult, MemoryOverviewSliceKind, ModuleAnalysisStatusParams,
    ModuleAnalysisStatusResult, ModuleInfoParams, ModuleInfoResult, ModuleMemoryOverviewParams,
    ModuleMemoryOverviewResult, ModuleOpenParams, ModuleOpenResult, ModuleUnloadParams,
    ModuleUnloadResult, SectionInfo, XrefRecord, XrefsToVaParams, XrefsToVaResult,
};
use crate::disasm::{parse_hex_u64, render_instruction, to_hex};
use crate::error::EngineError;
use crate::linear::{
    DATA_GROUP_SIZE, LINEAR_ROW_HEIGHT, MAX_LINEAR_PAGE_ROWS, find_row_by_rva,
    materialize_linear_row,
};
use crate::pe_utils::{SectionLookup, build_section_lookup, parse_pe64};
const DEFAULT_MAX_INSTRUCTIONS: usize = 512;
const MAX_MAX_INSTRUCTIONS: usize = 4096;
const MEMORY_OVERVIEW_TARGET_SLICE_COUNT: usize = 1000;

#[derive(Debug, Clone, Copy)]
struct MemoryRangeSpec {
    start_rva: u64,
    end_rva: u64,
}

#[derive(Debug, Clone, Copy)]
struct BaseMemoryRegion {
    start_rva: u64,
    end_rva: u64,
    readable: bool,
    writable: bool,
    executable: bool,
}

#[derive(Debug, Clone, Copy)]
struct MemoryOverviewSegment {
    start_rva: u64,
    end_rva: u64,
    kind: MemoryOverviewSliceKind,
}

#[derive(Debug)]
struct ModuleState {
    bytes: Arc<Vec<u8>>,
    image_base: u64,
    section_lookup: SectionLookup,
    base_memory_overview: ModuleMemoryOverviewResult,
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
    ready_memory_overview: Option<ModuleMemoryOverviewResult>,
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
            ready_memory_overview: None,
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

    fn mark_ready(
        &mut self,
        analysis: ModuleAnalysis,
        ready_memory_overview: ModuleMemoryOverviewResult,
    ) {
        self.lifecycle_state = AnalysisLifecycleState::Ready;
        self.message = "Analysis ready.".to_owned();
        self.total_function_count = Some(analysis.functions.len());
        self.analyzed_function_count = Some(analysis.functions.len());
        self.discovered_functions = Arc::new(analysis.functions.clone());
        self.analysis = Some(analysis);
        self.ready_memory_overview = Some(ready_memory_overview);
        self.failure_message = None;
    }

    fn mark_failed(&mut self, message: String) {
        self.lifecycle_state = AnalysisLifecycleState::Failed;
        self.message = format!("Analysis failed: {message}");
        self.failure_message = Some(message);
        self.analysis = None;
        self.ready_memory_overview = None;
    }

    fn mark_canceled(&mut self) {
        self.lifecycle_state = AnalysisLifecycleState::Canceled;
        self.message = "Analysis canceled.".to_owned();
        self.analysis = None;
        self.ready_memory_overview = None;
        self.failure_message = None;
    }
}

#[derive(Debug, Default)]
pub struct EngineState {
    next_module_id: usize,
    modules: HashMap<String, ModuleState>,
}

impl EngineState {
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
        let base_memory_overview = build_memory_overview(image_base, &section_lookup, None);

        self.next_module_id += 1;
        let module_id = format!("m{}", self.next_module_id);
        let analysis_task = spawn_background_analysis(
            path.clone(),
            Arc::clone(&bytes),
            image_base,
            section_lookup.clone(),
        );

        self.modules.insert(
            module_id.clone(),
            ModuleState {
                bytes,
                image_base,
                section_lookup,
                base_memory_overview,
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

    pub fn get_module_memory_overview(
        &mut self,
        params: ModuleMemoryOverviewParams,
    ) -> Result<ModuleMemoryOverviewResult, EngineError> {
        let module = self
            .modules
            .get(&params.module_id)
            .ok_or(EngineError::ModuleNotFound)?;
        let snapshot = module.analysis_task.lock_state()?;

        Ok(snapshot
            .ready_memory_overview
            .clone()
            .unwrap_or_else(|| module.base_memory_overview.clone()))
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
        let owner_start_rva =
            instruction_owner_for_rva(&analysis.instruction_owner_by_rva, target_rva)
                .ok_or(EngineError::InvalidAddress)?;
        let graph = analysis
            .graphs_by_start
            .get(&owner_start_rva)
            .ok_or(EngineError::InvalidAddress)?;
        let focus_block_start_rva = graph
            .instruction_block_start_by_rva
            .get(&target_rva)
            .copied()
            .ok_or(EngineError::InvalidAddress)?;
        let focus_block_id = graph_block_id(focus_block_start_rva);

        let mut blocks = Vec::with_capacity(graph.blocks.len());
        for block in &graph.blocks {
            let mut instructions = Vec::with_capacity(block.instructions.len());
            for cached_inst in &block.instructions {
                let rendered = render_instruction(
                    module.bytes.as_slice(),
                    &module.section_lookup,
                    image_base,
                    cached_inst.start_rva,
                    cached_inst.len,
                    false,
                    &analysis.function_names_by_start_rva,
                )?;

                instructions.push(crate::api::FunctionGraphInstruction {
                    address: to_hex(image_base + cached_inst.start_rva),
                    mnemonic: rendered.mnemonic,
                    operands: rendered.operands,
                    instruction_category: cached_inst.instruction_category,
                    branch_target: cached_inst
                        .branch_target_rva
                        .map(|target| to_hex(image_base + target)),
                    call_target: cached_inst
                        .call_target_rva
                        .map(|target| to_hex(image_base + target)),
                });
            }
            let end_rva = block
                .instructions
                .last()
                .map(|instruction| instruction.start_rva + u64::from(instruction.len))
                .unwrap_or(block.start_rva);
            blocks.push(crate::api::FunctionGraphBlock {
                id: block.id.clone(),
                start_va: to_hex(image_base + block.start_rva),
                end_va: to_hex(image_base + end_rva),
                is_entry: block.start_rva == graph.function_start_rva,
                is_exit: block.ends_with_return || !block.has_outgoing_edges,
                instructions,
            });
        }

        let edges = graph
            .edges
            .iter()
            .map(|edge| crate::api::FunctionGraphEdge {
                id: edge.id.clone(),
                from_block_id: edge.from_block_id.clone(),
                to_block_id: edge.to_block_id.clone(),
                kind: edge.kind,
                source_instruction_va: to_hex(image_base + edge.source_instruction_rva),
                is_back_edge: edge.to_block_start_rva <= edge.from_block_start_rva,
            })
            .collect();

        Ok(FunctionGraphByVaResult {
            function_start_va: to_hex(image_base + graph.function_start_rva),
            function_name: graph.function_name.clone(),
            focus_block_id,
            blocks,
            edges,
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
        let owner_start_rva =
            instruction_owner_for_rva(&analysis.instruction_owner_by_rva, start_rva)
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
            let rendered = render_instruction(
                module.bytes.as_slice(),
                &module.section_lookup,
                image_base,
                row.start_rva,
                row.len,
                true,
                &analysis.function_names_by_start_rva,
            )?;

            instructions.push(InstructionRow {
                address: to_hex(image_base + row.start_rva),
                bytes: rendered.bytes.unwrap_or_default(),
                mnemonic: rendered.mnemonic,
                operands: rendered.operands,
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
                &analysis.function_names_by_start_rva,
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

    pub fn get_xrefs_to_va(
        &mut self,
        params: XrefsToVaParams,
    ) -> Result<XrefsToVaResult, EngineError> {
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
        if !module.section_lookup.has_mapped_rva(target_rva) {
            return Err(EngineError::InvalidAddress);
        }

        let xrefs = analysis
            .xrefs_to_by_target_rva
            .get(&target_rva)
            .into_iter()
            .flat_map(|entries| entries.iter())
            .map(|xref| {
                let source_function_name = analysis
                    .function_names_by_start_rva
                    .get(&xref.source_function_start_rva)
                    .ok_or_else(|| {
                        EngineError::Internal(format!(
                            "Missing function name for xref source function {:X}",
                            xref.source_function_start_rva
                        ))
                    })?;
                Ok(XrefRecord {
                    source_va: to_hex(image_base + xref.source_instruction_rva),
                    source_function_start_va: to_hex(image_base + xref.source_function_start_rva),
                    source_function_name: source_function_name.clone(),
                    kind: xref.kind,
                    target_va: to_hex(image_base + xref.target_rva),
                    target_kind: xref.target_kind,
                })
            })
            .collect::<Result<Vec<_>, EngineError>>()?;

        Ok(XrefsToVaResult {
            target_va: to_hex(target_va),
            xrefs,
        })
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

fn spawn_background_analysis(
    path: PathBuf,
    bytes: Arc<Vec<u8>>,
    image_base: u64,
    section_lookup: SectionLookup,
) -> BackgroundAnalysisHandle {
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

        let ready_memory_overview =
            match &result {
                Ok(analysis) if !worker_cancel.load(Ordering::Relaxed) => Some(
                    build_memory_overview(image_base, &section_lookup, Some(analysis)),
                ),
                _ => None,
            };

        if let Ok(mut state) = worker_shared.lock() {
            match result {
                Ok(_analysis) if worker_cancel.load(Ordering::Relaxed) => state.mark_canceled(),
                Ok(analysis) => {
                    if worker_cancel.load(Ordering::Relaxed) {
                        state.mark_canceled();
                    } else {
                        state.mark_ready(
                            analysis,
                            ready_memory_overview.unwrap_or_else(|| {
                                build_memory_overview(image_base, &section_lookup, None)
                            }),
                        );
                    }
                }
                Err(EngineError::Canceled) => state.mark_canceled(),
                Err(error) => state.mark_failed(error.to_string()),
            }
        }
    });

    BackgroundAnalysisHandle { shared, cancel }
}

fn build_memory_overview(
    image_base: u64,
    section_lookup: &SectionLookup,
    analysis: Option<&ModuleAnalysis>,
) -> ModuleMemoryOverviewResult {
    let mapped_regions = collect_base_memory_regions(section_lookup);
    let discovered_ranges = collect_discovered_instruction_ranges(analysis);

    let start_rva = mapped_regions
        .first()
        .map(|region| region.start_rva)
        .unwrap_or(0);
    let end_rva = mapped_regions
        .last()
        .map(|region| region.end_rva)
        .unwrap_or(0);
    let slices =
        build_memory_overview_slices(start_rva, end_rva, &mapped_regions, &discovered_ranges);

    ModuleMemoryOverviewResult {
        start_va: to_hex(image_base + start_rva),
        end_va: to_hex(image_base + end_rva),
        slices,
    }
}

fn collect_base_memory_regions(section_lookup: &SectionLookup) -> Vec<BaseMemoryRegion> {
    let mut regions = Vec::new();

    let size_of_headers = section_lookup.size_of_headers();
    if size_of_headers > 0 {
        regions.push(BaseMemoryRegion {
            start_rva: 0,
            end_rva: size_of_headers,
            readable: true,
            writable: false,
            executable: false,
        });
    }

    for section in section_lookup.sections() {
        if section.end_rva <= section.start_rva {
            continue;
        }
        regions.push(BaseMemoryRegion {
            start_rva: section.start_rva,
            end_rva: section.end_rva,
            readable: section.readable,
            writable: section.writable,
            executable: section.executable,
        });
    }

    regions.sort_by_key(|region| region.start_rva);
    regions
}

fn collect_discovered_instruction_ranges(
    analysis: Option<&ModuleAnalysis>,
) -> Vec<MemoryRangeSpec> {
    let Some(analysis) = analysis else {
        return Vec::new();
    };

    merge_instruction_owner_ranges(&analysis.instruction_owner_by_rva)
}

fn merge_instruction_owner_ranges(
    instruction_owner_by_rva: &std::collections::BTreeMap<u64, InstructionOwnerRange>,
) -> Vec<MemoryRangeSpec> {
    let mut ranges = Vec::<MemoryRangeSpec>::new();

    for (&start_rva, range) in instruction_owner_by_rva {
        if range.end_rva <= start_rva {
            continue;
        }

        match ranges.last_mut() {
            Some(previous) if start_rva <= previous.end_rva => {
                if range.end_rva > previous.end_rva {
                    previous.end_rva = range.end_rva;
                }
            }
            _ => ranges.push(MemoryRangeSpec {
                start_rva,
                end_rva: range.end_rva,
            }),
        }
    }

    ranges
}

fn build_memory_overview_slices(
    start_rva: u64,
    end_rva: u64,
    mapped_regions: &[BaseMemoryRegion],
    discovered_ranges: &[MemoryRangeSpec],
) -> Vec<MemoryOverviewSliceKind> {
    if end_rva <= start_rva {
        return Vec::new();
    }

    let segments =
        build_memory_overview_segments(start_rva, end_rva, mapped_regions, discovered_ranges);
    let span = end_rva - start_rva;
    let slice_count = span
        .min(MEMORY_OVERVIEW_TARGET_SLICE_COUNT as u64)
        .try_into()
        .unwrap_or(MEMORY_OVERVIEW_TARGET_SLICE_COUNT);
    let mut slices = Vec::with_capacity(slice_count);
    let mut segment_index = 0usize;

    for slice_index in 0..slice_count {
        let slice_start = start_rva + ((slice_index as u64) * span) / (slice_count as u64);
        let slice_end = start_rva + (((slice_index + 1) as u64) * span) / (slice_count as u64);
        let mut totals = [0u64; 6];

        while segment_index < segments.len() && segments[segment_index].end_rva <= slice_start {
            segment_index += 1;
        }

        let mut current_index = segment_index;
        while let Some(segment) = segments.get(current_index) {
            if segment.start_rva >= slice_end {
                break;
            }

            let overlap_start = segment.start_rva.max(slice_start);
            let overlap_end = segment.end_rva.min(slice_end);
            if overlap_end > overlap_start {
                totals[segment.kind.dominance_index()] += overlap_end - overlap_start;
            }

            if segment.end_rva >= slice_end {
                break;
            }

            current_index += 1;
        }

        slices.push(MemoryOverviewSliceKind::dominant_for_totals(totals));
    }

    slices
}

fn build_memory_overview_segments(
    start_rva: u64,
    end_rva: u64,
    mapped_regions: &[BaseMemoryRegion],
    discovered_ranges: &[MemoryRangeSpec],
) -> Vec<MemoryOverviewSegment> {
    let mut output = Vec::<MemoryOverviewSegment>::new();

    let mut cursor = start_rva;
    let mut discovered_index = 0usize;

    for region in mapped_regions {
        if region.end_rva <= start_rva || region.start_rva >= end_rva {
            continue;
        }

        let region_start = region.start_rva.max(start_rva);
        let region_end = region.end_rva.min(end_rva);
        if region_end <= region_start {
            continue;
        }

        if cursor < region_start {
            push_memory_overview_segment(
                &mut output,
                cursor,
                region_start,
                MemoryOverviewSliceKind::Unmapped,
            );
        }

        cursor = region_end;

        if !region.executable {
            push_memory_overview_segment(
                &mut output,
                region_start,
                region_end,
                mapped_region_kind(region),
            );
            continue;
        }

        while discovered_index < discovered_ranges.len()
            && discovered_ranges[discovered_index].end_rva <= region_start
        {
            discovered_index += 1;
        }

        let mut range_index = discovered_index;
        let mut mapped_cursor = region_start;

        while mapped_cursor < region_end {
            while range_index < discovered_ranges.len()
                && discovered_ranges[range_index].end_rva <= mapped_cursor
            {
                range_index += 1;
            }

            let Some(range) = discovered_ranges.get(range_index) else {
                push_memory_overview_segment(
                    &mut output,
                    mapped_cursor,
                    region_end,
                    MemoryOverviewSliceKind::Unexplored,
                );
                break;
            };

            if range.start_rva >= region_end {
                push_memory_overview_segment(
                    &mut output,
                    mapped_cursor,
                    region_end,
                    MemoryOverviewSliceKind::Unexplored,
                );
                break;
            }

            if mapped_cursor < range.start_rva {
                let undiscovered_end = range.start_rva.min(region_end);
                push_memory_overview_segment(
                    &mut output,
                    mapped_cursor,
                    undiscovered_end,
                    MemoryOverviewSliceKind::Unexplored,
                );
                mapped_cursor = undiscovered_end;
                continue;
            }

            let discovered_end = range.end_rva.min(region_end);
            if discovered_end <= mapped_cursor {
                range_index += 1;
                continue;
            }

            push_memory_overview_segment(
                &mut output,
                mapped_cursor,
                discovered_end,
                MemoryOverviewSliceKind::Explored,
            );
            mapped_cursor = discovered_end;
        }

        discovered_index = range_index;
    }

    if cursor < end_rva {
        push_memory_overview_segment(
            &mut output,
            cursor,
            end_rva,
            MemoryOverviewSliceKind::Unmapped,
        );
    }

    output
}

fn push_memory_overview_segment(
    output: &mut Vec<MemoryOverviewSegment>,
    start_rva: u64,
    end_rva: u64,
    kind: MemoryOverviewSliceKind,
) {
    if end_rva <= start_rva {
        return;
    }

    let next_segment = MemoryOverviewSegment {
        start_rva,
        end_rva,
        kind,
    };

    if let Some(previous) = output.last_mut() {
        if previous.kind == next_segment.kind && previous.end_rva == next_segment.start_rva {
            previous.end_rva = next_segment.end_rva;
            return;
        }
    }

    output.push(next_segment);
}

fn mapped_region_kind(region: &BaseMemoryRegion) -> MemoryOverviewSliceKind {
    if region.executable && region.writable {
        return MemoryOverviewSliceKind::Rwx;
    }
    if region.writable {
        return MemoryOverviewSliceKind::Rw;
    }
    if region.readable {
        return MemoryOverviewSliceKind::Ro;
    }
    MemoryOverviewSliceKind::Ro
}

impl MemoryOverviewSliceKind {
    fn dominance_index(self) -> usize {
        match self {
            Self::Explored => 0,
            Self::Unexplored => 1,
            Self::Rwx => 2,
            Self::Rw => 3,
            Self::Ro => 4,
            Self::Unmapped => 5,
        }
    }

    fn dominant_for_totals(totals: [u64; 6]) -> Self {
        let mut best_index = 5usize;
        let mut best_total = 0u64;

        for (index, total) in totals.into_iter().enumerate() {
            if total > best_total {
                best_total = total;
                best_index = index;
            }
        }

        match best_index {
            0 => Self::Explored,
            1 => Self::Unexplored,
            2 => Self::Rwx,
            3 => Self::Rw,
            4 => Self::Ro,
            _ => Self::Unmapped,
        }
    }
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

fn graph_block_id(block_start_rva: u64) -> String {
    format!("b_{block_start_rva:X}")
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

#[cfg(test)]
mod tests {
    use super::{
        BaseMemoryRegion, MEMORY_OVERVIEW_TARGET_SLICE_COUNT, MemoryRangeSpec,
        build_memory_overview_segments, build_memory_overview_slices,
        merge_instruction_owner_ranges,
    };
    use crate::analysis::InstructionOwnerRange;
    use crate::api::MemoryOverviewSliceKind;
    use std::collections::BTreeMap;

    #[test]
    fn merge_instruction_owner_ranges_merges_sorted_instruction_ranges() {
        let instruction_owner_by_rva = [(0x1010, 0x1015), (0x1015, 0x1018), (0x1020, 0x1022)]
            .into_iter()
            .map(|(start_rva, end_rva)| {
                (
                    start_rva,
                    InstructionOwnerRange {
                        end_rva,
                        function_start_rva: start_rva,
                    },
                )
            })
            .collect::<BTreeMap<u64, InstructionOwnerRange>>();

        let ranges = merge_instruction_owner_ranges(&instruction_owner_by_rva);

        assert_eq!(ranges.len(), 2);
        assert_eq!(ranges[0].start_rva, 0x1010);
        assert_eq!(ranges[0].end_rva, 0x1018);
        assert_eq!(ranges[1].start_rva, 0x1020);
        assert_eq!(ranges[1].end_rva, 0x1022);
    }

    #[test]
    fn build_memory_overview_segments_splits_executable_regions_by_discovery() {
        let segments = build_memory_overview_segments(
            0x1000,
            0x4000,
            &[
                BaseMemoryRegion {
                    start_rva: 0x1000,
                    end_rva: 0x1800,
                    readable: true,
                    writable: false,
                    executable: false,
                },
                BaseMemoryRegion {
                    start_rva: 0x2000,
                    end_rva: 0x4000,
                    readable: true,
                    writable: false,
                    executable: true,
                },
            ],
            &[
                MemoryRangeSpec {
                    start_rva: 0x2100,
                    end_rva: 0x2200,
                },
                MemoryRangeSpec {
                    start_rva: 0x2300,
                    end_rva: 0x2400,
                },
            ],
        );

        assert_eq!(segments.len(), 7);
        assert_eq!(segments[0].start_rva, 0x1000);
        assert_eq!(segments[0].end_rva, 0x1800);
        assert_eq!(segments[0].kind, MemoryOverviewSliceKind::Ro);

        assert_eq!(segments[1].start_rva, 0x1800);
        assert_eq!(segments[1].end_rva, 0x2000);
        assert_eq!(segments[1].kind, MemoryOverviewSliceKind::Unmapped);

        assert_eq!(segments[2].start_rva, 0x2000);
        assert_eq!(segments[2].end_rva, 0x2100);
        assert_eq!(segments[2].kind, MemoryOverviewSliceKind::Unexplored);

        assert_eq!(segments[3].start_rva, 0x2100);
        assert_eq!(segments[3].end_rva, 0x2200);
        assert_eq!(segments[3].kind, MemoryOverviewSliceKind::Explored);

        assert_eq!(segments[4].start_rva, 0x2200);
        assert_eq!(segments[4].end_rva, 0x2300);
        assert_eq!(segments[4].kind, MemoryOverviewSliceKind::Unexplored);

        assert_eq!(segments[5].start_rva, 0x2300);
        assert_eq!(segments[5].end_rva, 0x2400);
        assert_eq!(segments[5].kind, MemoryOverviewSliceKind::Explored);

        assert_eq!(segments[6].start_rva, 0x2400);
        assert_eq!(segments[6].end_rva, 0x4000);
        assert_eq!(segments[6].kind, MemoryOverviewSliceKind::Unexplored);
    }

    #[test]
    fn build_memory_overview_slices_uses_fixed_slice_budget_and_dominant_kind() {
        let slices = build_memory_overview_slices(
            0x1000,
            0x1800,
            &[BaseMemoryRegion {
                start_rva: 0x1000,
                end_rva: 0x1400,
                readable: true,
                writable: false,
                executable: false,
            }],
            &[],
        );

        assert_eq!(slices.len(), MEMORY_OVERVIEW_TARGET_SLICE_COUNT);
        assert_eq!(slices[0], MemoryOverviewSliceKind::Ro);
        assert_eq!(slices[slices.len() - 1], MemoryOverviewSliceKind::Unmapped);

        let explored_slices = build_memory_overview_slices(
            0x1000,
            0x1004,
            &[BaseMemoryRegion {
                start_rva: 0x1000,
                end_rva: 0x1004,
                readable: true,
                writable: false,
                executable: true,
            }],
            &[MemoryRangeSpec {
                start_rva: 0x1000,
                end_rva: 0x1003,
            }],
        );

        assert_eq!(explored_slices.len(), 4);
        assert_eq!(explored_slices[0], MemoryOverviewSliceKind::Explored);
        assert_eq!(explored_slices[1], MemoryOverviewSliceKind::Explored);
        assert_eq!(explored_slices[2], MemoryOverviewSliceKind::Explored);
        assert_eq!(explored_slices[3], MemoryOverviewSliceKind::Unexplored);
    }
}
