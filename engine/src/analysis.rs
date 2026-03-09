use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::ops::Bound::{Excluded, Unbounded};
use std::path::Path;
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc::{self, RecvTimeoutError},
};
use std::thread;
use std::time::Duration;

use goblin::pe::PE;

use crate::api::{InstructionCategory, XrefKind, XrefTargetKind};
use crate::cfg::{BasicBlockEdgeKind, FunctionGraphAnalysis, analyze_function_cfg};
use crate::disasm::default_function_name;
use crate::error::EngineError;
use crate::linear::{AnalyzedInstructionRow, LinearView, build_linear_view};
use crate::pdb_symbols::discover_pdb_function_seeds;
use crate::pe_utils::{
    SectionLookup, build_section_lookup, collect_exception_function_starts,
    collect_tls_callback_starts, parse_pe64,
};

#[derive(Debug, Clone)]
pub(crate) struct FunctionSeedEntry {
    pub(crate) start_rva: u64,
    pub(crate) name: String,
    pub(crate) kind: &'static str,
}

#[derive(Debug)]
pub(crate) struct ModuleAnalysis {
    pub(crate) functions: Vec<FunctionSeedEntry>,
    pub(crate) linear_view: LinearView,
    pub(crate) graphs_by_start: HashMap<u64, CachedFunctionGraph>,
    pub(crate) function_names_by_start_rva: HashMap<u64, String>,
    pub(crate) instruction_owner_by_rva: BTreeMap<u64, InstructionOwnerRange>,
    pub(crate) claimed_instructions_by_function_start: HashMap<u64, Vec<AnalyzedInstructionRow>>,
    pub(crate) xrefs_to_by_target_rva: HashMap<u64, Vec<CachedXref>>,
}

#[derive(Debug, Clone)]
pub(crate) struct CachedFunctionGraph {
    pub(crate) function_start_rva: u64,
    pub(crate) function_name: String,
    pub(crate) blocks: Vec<CachedFunctionGraphBlock>,
    pub(crate) edges: Vec<CachedFunctionGraphEdge>,
    pub(crate) instruction_block_start_by_rva: HashMap<u64, u64>,
}

#[derive(Debug, Clone)]
pub(crate) struct CachedFunctionGraphEdge {
    pub(crate) id: String,
    pub(crate) from_block_id: String,
    pub(crate) to_block_id: String,
    pub(crate) kind: &'static str,
    pub(crate) from_block_start_rva: u64,
    pub(crate) to_block_start_rva: u64,
    pub(crate) source_instruction_rva: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct CachedFunctionGraphBlock {
    pub(crate) id: String,
    pub(crate) start_rva: u64,
    pub(crate) has_outgoing_edges: bool,
    pub(crate) ends_with_return: bool,
    pub(crate) instructions: Vec<CachedFunctionGraphInstruction>,
}

#[derive(Debug, Clone)]
pub(crate) struct CachedFunctionGraphInstruction {
    pub(crate) start_rva: u64,
    pub(crate) len: u8,
    pub(crate) instruction_category: InstructionCategory,
    pub(crate) branch_target_rva: Option<u64>,
    pub(crate) call_target_rva: Option<u64>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct InstructionOwnerRange {
    pub(crate) end_rva: u64,
    pub(crate) function_start_rva: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CachedXref {
    pub(crate) source_instruction_rva: u64,
    pub(crate) source_function_start_rva: u64,
    pub(crate) target_rva: u64,
    pub(crate) kind: XrefKind,
    pub(crate) target_kind: XrefTargetKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AnalysisProgressPhase {
    DiscoveringFunctions,
    AnalyzingFunctions,
    FinalizingLinearView,
}

impl AnalysisProgressPhase {
    pub(crate) fn message(
        self,
        discovered_function_count: usize,
        analyzed_function_count: Option<usize>,
        total_function_count: Option<usize>,
    ) -> String {
        match self {
            Self::DiscoveringFunctions => {
                format!("Discovering functions ({discovered_function_count})...")
            }
            Self::AnalyzingFunctions => format!(
                "Analyzing functions {} / {}...",
                analyzed_function_count.unwrap_or(0),
                total_function_count.unwrap_or(discovered_function_count)
            ),
            Self::FinalizingLinearView => "Finalizing analysis...".to_owned(),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct AnalysisProgressUpdate {
    pub(crate) phase: AnalysisProgressPhase,
    pub(crate) discovered_functions: Arc<Vec<FunctionSeedEntry>>,
    pub(crate) total_function_count: Option<usize>,
    pub(crate) analyzed_function_count: Option<usize>,
}

#[derive(Debug, Clone)]
struct FunctionSeedCandidate {
    seed: FunctionSeedEntry,
    priority: u8,
}

#[derive(Debug)]
struct CompletedFunctionAnalysis {
    function_start_rva: u64,
    cached_graph: CachedFunctionGraph,
    function_rows: Vec<AnalyzedInstructionRow>,
}

const ANALYSIS_RESULT_POLL_INTERVAL: Duration = Duration::from_millis(20);

pub(crate) fn build_module_analysis_with_progress<F, C>(
    module_path: &Path,
    bytes: &[u8],
    mut on_progress: F,
    mut is_canceled: C,
) -> Result<ModuleAnalysis, EngineError>
where
    F: FnMut(AnalysisProgressUpdate),
    C: FnMut() -> bool,
{
    let pe = parse_pe64(bytes)?;
    let section_lookup = build_section_lookup(&pe);
    let image_base = pe.image_base as u64;
    let mut ordered = discover_initial_function_seed_candidates_with_progress(
        module_path,
        &pe,
        image_base,
        &section_lookup,
        &mut on_progress,
    )?;

    if is_canceled() {
        return Err(EngineError::Canceled);
    }

    let mut analyzed_seed_starts = BTreeSet::<u64>::new();
    let mut completed_by_start = HashMap::<u64, Option<CompletedFunctionAnalysis>>::new();
    let mut non_call_instruction_owner_by_rva = BTreeMap::<u64, InstructionOwnerRange>::new();

    loop {
        let analysis_order = ordered
            .values()
            .filter(|candidate| !analyzed_seed_starts.contains(&candidate.seed.start_rva))
            .map(|candidate| candidate.seed.clone())
            .collect::<Vec<FunctionSeedEntry>>();
        if analysis_order.is_empty() {
            break;
        }

        let results = analyze_seed_batch(
            bytes,
            &section_lookup,
            image_base,
            &analysis_order,
            &mut is_canceled,
        )?;

        let mut discovery_changed = false;
        for (seed, completed) in results {
            analyzed_seed_starts.insert(seed.start_rva);

            if let Some(completed) = completed {
                if seed.kind != "call" {
                    claim_function_rows_for_owner(
                        completed.function_start_rva,
                        &completed.function_rows,
                        &mut non_call_instruction_owner_by_rva,
                    );
                }

                discovery_changed |= discover_call_target_seeds(
                    &completed,
                    image_base,
                    &section_lookup,
                    &mut ordered,
                    &non_call_instruction_owner_by_rva,
                );
                completed_by_start.insert(seed.start_rva, Some(completed));
            } else {
                completed_by_start.insert(seed.start_rva, None);
            }
        }

        if discovery_changed {
            emit_discovery_progress(&ordered, &mut on_progress);
        }

        if is_canceled() {
            return Err(EngineError::Canceled);
        }
    }

    let functions = Arc::new(collect_discovered_function_entries(&ordered));
    let mut analysis_order = (*functions).clone();
    analysis_order.sort_by_key(|seed| (seed_priority(seed.kind), seed.start_rva));
    on_progress(AnalysisProgressUpdate {
        phase: AnalysisProgressPhase::AnalyzingFunctions,
        discovered_functions: Arc::clone(&functions),
        total_function_count: Some(functions.len()),
        analyzed_function_count: Some(0),
    });

    let mut graphs_by_start = HashMap::<u64, CachedFunctionGraph>::new();
    let mut instruction_owner_by_rva = BTreeMap::<u64, InstructionOwnerRange>::new();
    let mut claimed_instructions = BTreeMap::<u64, AnalyzedInstructionRow>::new();
    let mut claimed_instructions_by_function_start =
        HashMap::<u64, Vec<AnalyzedInstructionRow>>::new();

    if !analysis_order.is_empty() {
        for (index, seed) in analysis_order.iter().enumerate() {
            if let Some(completed) = completed_by_start.remove(&seed.start_rva) {
                if let Some(completed) = completed {
                    merge_completed_function_analysis(
                        completed,
                        &mut graphs_by_start,
                        &mut instruction_owner_by_rva,
                        &mut claimed_instructions,
                        &mut claimed_instructions_by_function_start,
                    );
                }
            } else {
                return Err(EngineError::Internal(format!(
                    "Missing analyzed function result for seed {:X}",
                    seed.start_rva
                )));
            }

            on_progress(AnalysisProgressUpdate {
                phase: AnalysisProgressPhase::AnalyzingFunctions,
                discovered_functions: Arc::clone(&functions),
                total_function_count: Some(functions.len()),
                analyzed_function_count: Some(index + 1),
            });
        }
    }

    if is_canceled() {
        return Err(EngineError::Canceled);
    }

    for rows in claimed_instructions_by_function_start.values_mut() {
        rows.sort_by_key(|row| row.start_rva);
    }

    on_progress(AnalysisProgressUpdate {
        phase: AnalysisProgressPhase::FinalizingLinearView,
        discovered_functions: Arc::clone(&functions),
        total_function_count: Some(functions.len()),
        analyzed_function_count: Some(functions.len()),
    });
    let linear_view = build_linear_view(&section_lookup, &claimed_instructions)?;
    let xrefs_to_by_target_rva = build_xref_indexes(
        &claimed_instructions_by_function_start,
        &instruction_owner_by_rva,
    );
    let function_names_by_start_rva = graphs_by_start
        .iter()
        .map(|(&start_rva, graph)| (start_rva, graph.function_name.clone()))
        .collect::<HashMap<u64, String>>();

    Ok(ModuleAnalysis {
        functions: (*functions).clone(),
        linear_view,
        graphs_by_start,
        function_names_by_start_rva,
        instruction_owner_by_rva,
        claimed_instructions_by_function_start,
        xrefs_to_by_target_rva,
    })
}

pub(crate) fn instruction_owner_for_rva(
    instruction_owner_by_rva: &BTreeMap<u64, InstructionOwnerRange>,
    target_rva: u64,
) -> Option<u64> {
    let candidate = instruction_owner_by_rva.range(..=target_rva).next_back();
    let (_, range) = candidate?;
    if range.end_rva > target_rva {
        Some(range.function_start_rva)
    } else {
        None
    }
}

fn build_xref_indexes(
    claimed_instructions_by_function_start: &HashMap<u64, Vec<AnalyzedInstructionRow>>,
    instruction_owner_by_rva: &BTreeMap<u64, InstructionOwnerRange>,
) -> HashMap<u64, Vec<CachedXref>> {
    let mut xrefs_to_by_target_rva = HashMap::<u64, Vec<CachedXref>>::new();

    for (&function_start_rva, rows) in claimed_instructions_by_function_start {
        for row in rows {
            for xref in &row.xrefs {
                if matches!(xref.target_kind, XrefTargetKind::Code)
                    && instruction_owner_for_rva(instruction_owner_by_rva, xref.target_rva)
                        .is_none()
                {
                    continue;
                }

                let cached = CachedXref {
                    source_instruction_rva: row.start_rva,
                    source_function_start_rva: function_start_rva,
                    target_rva: xref.target_rva,
                    kind: xref.kind,
                    target_kind: xref.target_kind,
                };
                xrefs_to_by_target_rva
                    .entry(cached.target_rva)
                    .or_default()
                    .push(cached);
            }
        }
    }

    for xrefs in xrefs_to_by_target_rva.values_mut() {
        xrefs.sort_by_key(|xref| {
            (
                xref.source_instruction_rva,
                xref.source_function_start_rva,
                xref.kind_sort_key(),
            )
        });
    }

    xrefs_to_by_target_rva
}

impl CachedXref {
    fn kind_sort_key(self) -> u8 {
        match self.kind {
            XrefKind::Call => 0,
            XrefKind::Jump => 1,
            XrefKind::Branch => 2,
            XrefKind::Data => 3,
        }
    }
}

fn instruction_range_overlaps(
    instruction_owner_by_rva: &BTreeMap<u64, InstructionOwnerRange>,
    start_rva: u64,
    end_rva: u64,
) -> bool {
    if start_rva >= end_rva {
        return false;
    }

    if let Some((_, range)) = instruction_owner_by_rva.range(..=start_rva).next_back() {
        if range.end_rva > start_rva {
            return true;
        }
    }

    if let Some((next_start, _next_range)) = instruction_owner_by_rva
        .range((Excluded(start_rva), Unbounded))
        .next()
    {
        let next_start = *next_start;
        if next_start < end_rva {
            return true;
        }
    }

    false
}

fn analysis_worker_count(function_count: usize) -> usize {
    if function_count == 0 {
        return 0;
    }

    thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(1)
        .min(function_count)
}

fn analyze_seed_batch(
    bytes: &[u8],
    section_lookup: &SectionLookup,
    image_base: u64,
    analysis_order: &[FunctionSeedEntry],
    mut is_canceled: impl FnMut() -> bool,
) -> Result<Vec<(FunctionSeedEntry, Option<CompletedFunctionAnalysis>)>, EngineError> {
    if analysis_order.is_empty() {
        return Ok(Vec::new());
    }

    let worker_count = analysis_worker_count(analysis_order.len());
    let next_index = AtomicUsize::new(0);
    let cancel_requested = AtomicBool::new(false);
    let stop_scheduling = AtomicBool::new(false);
    let (sender, receiver) = mpsc::channel::<(
        usize,
        Result<Option<CompletedFunctionAnalysis>, EngineError>,
    )>();
    let mut ordered_results = (0..analysis_order.len())
        .map(|_| None)
        .collect::<Vec<Option<Option<CompletedFunctionAnalysis>>>>();
    let mut first_error = None;
    let mut completed_count = 0usize;

    thread::scope(|scope| {
        for _ in 0..worker_count {
            let sender = sender.clone();
            let analysis_order = analysis_order;
            let next_index = &next_index;
            let cancel_requested = &cancel_requested;
            let stop_scheduling = &stop_scheduling;
            let section_lookup = section_lookup;

            scope.spawn(move || {
                loop {
                    if stop_scheduling.load(Ordering::Relaxed) {
                        break;
                    }

                    let index = next_index.fetch_add(1, Ordering::Relaxed);
                    if index >= analysis_order.len() {
                        break;
                    }

                    let result = analyze_seed(
                        bytes,
                        section_lookup,
                        image_base,
                        &analysis_order[index],
                        || cancel_requested.load(Ordering::Relaxed),
                    );
                    if result
                        .as_ref()
                        .is_err_and(|error| !matches!(error, EngineError::Canceled))
                    {
                        stop_scheduling.store(true, Ordering::Relaxed);
                    }
                    if sender.send((index, result)).is_err() {
                        break;
                    }
                }
            });
        }
        drop(sender);

        loop {
            if is_canceled() {
                cancel_requested.store(true, Ordering::Relaxed);
                stop_scheduling.store(true, Ordering::Relaxed);
            }

            match receiver.recv_timeout(ANALYSIS_RESULT_POLL_INTERVAL) {
                Ok((index, result)) => {
                    completed_count += 1;
                    match result {
                        Ok(completed) => {
                            ordered_results[index] = Some(completed);
                        }
                        Err(EngineError::Canceled) if cancel_requested.load(Ordering::Relaxed) => {}
                        Err(error) => {
                            stop_scheduling.store(true, Ordering::Relaxed);
                            if first_error.is_none() {
                                first_error = Some(error);
                            }
                        }
                    }
                }
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => break,
            }

            if completed_count >= analysis_order.len() {
                break;
            }
        }
    });

    if cancel_requested.load(Ordering::Relaxed) || is_canceled() {
        return Err(EngineError::Canceled);
    }

    if let Some(error) = first_error {
        return Err(error);
    }

    if ordered_results.iter().any(Option::is_none) {
        return Err(EngineError::Internal(
            "Parallel function analysis produced incomplete results".to_owned(),
        ));
    }

    Ok(analysis_order
        .iter()
        .cloned()
        .zip(
            ordered_results
                .into_iter()
                .map(|result| result.unwrap_or(None)),
        )
        .collect())
}

fn analyze_seed(
    bytes: &[u8],
    section_lookup: &SectionLookup,
    image_base: u64,
    seed: &FunctionSeedEntry,
    mut is_canceled: impl FnMut() -> bool,
) -> Result<Option<CompletedFunctionAnalysis>, EngineError> {
    let analysis = match analyze_function_cfg(
        bytes,
        section_lookup,
        image_base,
        seed.start_rva,
        &mut is_canceled,
    ) {
        Ok(analysis) => analysis,
        Err(EngineError::InvalidAddress) => return Ok(None),
        Err(error) => return Err(error),
    };

    if is_canceled() {
        return Err(EngineError::Canceled);
    }

    let (cached_graph, function_rows) = build_cached_function_graph(analysis, seed.name.clone());

    if is_canceled() {
        return Err(EngineError::Canceled);
    }

    Ok(Some(CompletedFunctionAnalysis {
        function_start_rva: seed.start_rva,
        cached_graph,
        function_rows,
    }))
}

fn merge_completed_function_analysis(
    completed: CompletedFunctionAnalysis,
    graphs_by_start: &mut HashMap<u64, CachedFunctionGraph>,
    instruction_owner_by_rva: &mut BTreeMap<u64, InstructionOwnerRange>,
    claimed_instructions: &mut BTreeMap<u64, AnalyzedInstructionRow>,
    claimed_instructions_by_function_start: &mut HashMap<u64, Vec<AnalyzedInstructionRow>>,
) {
    for row in completed.function_rows {
        if !try_claim_instruction_row(instruction_owner_by_rva, completed.function_start_rva, &row)
        {
            continue;
        }

        claimed_instructions
            .entry(row.start_rva)
            .or_insert_with(|| row.clone());
        claimed_instructions_by_function_start
            .entry(completed.function_start_rva)
            .or_default()
            .push(row);
    }

    graphs_by_start.insert(completed.function_start_rva, completed.cached_graph);
}

fn claim_function_rows_for_owner(
    function_start_rva: u64,
    function_rows: &[AnalyzedInstructionRow],
    instruction_owner_by_rva: &mut BTreeMap<u64, InstructionOwnerRange>,
) {
    for row in function_rows {
        let _ = try_claim_instruction_row(instruction_owner_by_rva, function_start_rva, row);
    }
}

fn try_claim_instruction_row(
    instruction_owner_by_rva: &mut BTreeMap<u64, InstructionOwnerRange>,
    function_start_rva: u64,
    row: &AnalyzedInstructionRow,
) -> bool {
    let row_end_rva = row.start_rva.saturating_add(u64::from(row.len));
    if instruction_range_overlaps(instruction_owner_by_rva, row.start_rva, row_end_rva) {
        return false;
    }

    instruction_owner_by_rva.insert(
        row.start_rva,
        InstructionOwnerRange {
            end_rva: row_end_rva,
            function_start_rva,
        },
    );
    true
}

fn discover_call_target_seeds(
    completed: &CompletedFunctionAnalysis,
    image_base: u64,
    section_lookup: &SectionLookup,
    ordered: &mut BTreeMap<u64, FunctionSeedCandidate>,
    non_call_instruction_owner_by_rva: &BTreeMap<u64, InstructionOwnerRange>,
) -> bool {
    let mut changed = false;

    for row in &completed.function_rows {
        let Some(target_rva) = row.call_target_rva else {
            continue;
        };
        if !section_lookup.is_executable_rva(target_rva) {
            continue;
        }
        if ordered.contains_key(&target_rva) {
            continue;
        }
        if instruction_owner_for_rva(non_call_instruction_owner_by_rva, target_rva).is_some() {
            continue;
        }

        changed |= register_seed(
            ordered,
            FunctionSeedCandidate {
                seed: FunctionSeedEntry {
                    start_rva: target_rva,
                    name: default_function_name(image_base + target_rva),
                    kind: "call",
                },
                priority: seed_priority("call"),
            },
        );
    }

    changed
}

fn discover_initial_function_seed_candidates_with_progress<F>(
    module_path: &Path,
    pe: &PE<'_>,
    image_base: u64,
    section_lookup: &SectionLookup,
    on_progress: &mut F,
) -> Result<BTreeMap<u64, FunctionSeedCandidate>, EngineError>
where
    F: FnMut(AnalysisProgressUpdate),
{
    let mut ordered = BTreeMap::<u64, FunctionSeedCandidate>::new();
    let entry_rva = pe.entry as u64;
    if section_lookup.is_executable_rva(entry_rva) {
        register_seed(
            &mut ordered,
            FunctionSeedCandidate {
                seed: FunctionSeedEntry {
                    start_rva: entry_rva,
                    name: default_function_name(image_base + entry_rva),
                    kind: "entry",
                },
                priority: seed_priority("entry"),
            },
        );
    }
    emit_discovery_progress(&ordered, on_progress);

    for export in &pe.exports {
        let rva = export.rva as u64;
        if !section_lookup.is_executable_rva(rva) {
            continue;
        }

        register_seed(
            &mut ordered,
            FunctionSeedCandidate {
                seed: FunctionSeedEntry {
                    start_rva: rva,
                    name: export
                        .name
                        .filter(|name| !name.is_empty())
                        .map(str::to_owned)
                        .unwrap_or_else(|| default_function_name(image_base + rva)),
                    kind: "export",
                },
                priority: seed_priority("export"),
            },
        );
    }
    emit_discovery_progress(&ordered, on_progress);

    for rva in collect_tls_callback_starts(pe) {
        register_seed(
            &mut ordered,
            FunctionSeedCandidate {
                seed: FunctionSeedEntry {
                    start_rva: rva,
                    name: default_function_name(image_base + rva),
                    kind: "tls",
                },
                priority: seed_priority("tls"),
            },
        );
    }
    emit_discovery_progress(&ordered, on_progress);

    for rva in collect_exception_function_starts(pe) {
        register_seed(
            &mut ordered,
            FunctionSeedCandidate {
                seed: FunctionSeedEntry {
                    start_rva: rva,
                    name: default_function_name(image_base + rva),
                    kind: "exception",
                },
                priority: seed_priority("exception"),
            },
        );
    }
    emit_discovery_progress(&ordered, on_progress);

    for pdb_function in discover_pdb_function_seeds(module_path, pe) {
        if !section_lookup.is_executable_rva(pdb_function.start_rva) {
            continue;
        }

        register_seed(
            &mut ordered,
            FunctionSeedCandidate {
                seed: FunctionSeedEntry {
                    start_rva: pdb_function.start_rva,
                    name: pdb_function.name,
                    kind: "pdb",
                },
                priority: seed_priority("pdb"),
            },
        );
    }
    emit_discovery_progress(&ordered, on_progress);

    Ok(ordered)
}

fn collect_discovered_function_entries(
    ordered: &BTreeMap<u64, FunctionSeedCandidate>,
) -> Vec<FunctionSeedEntry> {
    ordered.values().cloned().map(|value| value.seed).collect()
}

fn emit_discovery_progress<F>(ordered: &BTreeMap<u64, FunctionSeedCandidate>, on_progress: &mut F)
where
    F: FnMut(AnalysisProgressUpdate),
{
    on_progress(AnalysisProgressUpdate {
        phase: AnalysisProgressPhase::DiscoveringFunctions,
        discovered_functions: Arc::new(collect_discovered_function_entries(ordered)),
        total_function_count: None,
        analyzed_function_count: None,
    });
}

fn register_seed(
    ordered: &mut BTreeMap<u64, FunctionSeedCandidate>,
    candidate: FunctionSeedCandidate,
) -> bool {
    match ordered.get(&candidate.seed.start_rva) {
        Some(existing) if existing.priority <= candidate.priority => false,
        _ => {
            ordered.insert(candidate.seed.start_rva, candidate);
            true
        }
    }
}

fn seed_priority(kind: &str) -> u8 {
    match kind {
        "pdb" => 0,
        "export" => 1,
        "tls" => 2,
        "entry" => 3,
        "exception" => 4,
        "call" => 5,
        _ => u8::MAX,
    }
}

fn build_cached_function_graph(
    analysis: FunctionGraphAnalysis,
    function_name: String,
) -> (CachedFunctionGraph, Vec<AnalyzedInstructionRow>) {
    let block_id_by_start_rva = analysis
        .blocks
        .iter()
        .map(|block| (block.start_rva, format!("b_{:X}", block.start_rva)))
        .collect::<HashMap<u64, String>>();
    let mut instruction_block_start_by_rva = HashMap::<u64, u64>::new();
    let mut linear_rows = Vec::<AnalyzedInstructionRow>::new();
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
                    for offset in 0..u64::from(instruction.len) {
                        instruction_block_start_by_rva
                            .insert(instruction.start_rva + offset, block.start_rva);
                    }
                    linear_rows.push(AnalyzedInstructionRow {
                        start_rva: instruction.start_rva,
                        len: instruction.len,
                        instruction_category: instruction.instruction_category,
                        branch_target_rva: instruction.branch_target_rva,
                        call_target_rva: instruction.call_target_rva,
                        xrefs: instruction.xrefs.clone(),
                    });
                    CachedFunctionGraphInstruction {
                        start_rva: instruction.start_rva,
                        len: instruction.len,
                        instruction_category: instruction.instruction_category,
                        branch_target_rva: instruction.branch_target_rva,
                        call_target_rva: instruction.call_target_rva,
                    }
                })
                .collect();

            CachedFunctionGraphBlock {
                id: block_id,
                start_rva: block.start_rva,
                has_outgoing_edges: analysis
                    .edges
                    .iter()
                    .any(|edge| edge.from_rva == block.start_rva),
                ends_with_return: block.instructions.last().is_some_and(|instruction| {
                    instruction.instruction_category == InstructionCategory::Return
                }),
                instructions,
            }
        })
        .collect::<Vec<CachedFunctionGraphBlock>>();

    linear_rows.sort_by_key(|row| row.start_rva);

    let edges = analysis
        .edges
        .iter()
        .filter_map(|edge| {
            let from_block_id = block_id_by_start_rva.get(&edge.from_rva)?;
            let to_block_id = block_id_by_start_rva.get(&edge.to_rva)?;
            Some(CachedFunctionGraphEdge {
                id: format!(
                    "e_{:X}_{:X}_{:X}",
                    edge.from_rva, edge.to_rva, edge.source_instruction_rva
                ),
                from_block_id: from_block_id.clone(),
                to_block_id: to_block_id.clone(),
                kind: match edge.kind {
                    BasicBlockEdgeKind::Conditional => "conditional",
                    BasicBlockEdgeKind::Unconditional => "unconditional",
                    BasicBlockEdgeKind::Fallthrough => "fallthrough",
                },
                from_block_start_rva: edge.from_rva,
                to_block_start_rva: edge.to_rva,
                source_instruction_rva: edge.source_instruction_rva,
            })
        })
        .collect::<Vec<CachedFunctionGraphEdge>>();

    (
        CachedFunctionGraph {
            function_start_rva: analysis.start_rva,
            function_name,
            blocks,
            edges,
            instruction_block_start_by_rva,
        },
        linear_rows,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        CachedFunctionGraph, CachedXref, CompletedFunctionAnalysis, FunctionSeedCandidate,
        InstructionOwnerRange, build_module_analysis_with_progress, build_xref_indexes,
        claim_function_rows_for_owner, discover_call_target_seeds, instruction_owner_for_rva,
        instruction_range_overlaps, merge_completed_function_analysis, register_seed,
        seed_priority,
    };
    use crate::api::{InstructionCategory, XrefKind, XrefTargetKind};
    use crate::linear::AnalyzedInstructionRow;
    use crate::pe_utils::{build_section_lookup, parse_pe64};
    use crate::{EngineError, fixture_path};
    use std::collections::{BTreeMap, HashMap};
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn instruction_row(start_rva: u64, len: u8) -> AnalyzedInstructionRow {
        AnalyzedInstructionRow {
            start_rva,
            len,
            instruction_category: InstructionCategory::Other,
            branch_target_rva: None,
            call_target_rva: None,
            xrefs: Vec::new(),
        }
    }

    fn call_instruction_row(
        start_rva: u64,
        len: u8,
        call_target_rva: u64,
    ) -> AnalyzedInstructionRow {
        AnalyzedInstructionRow {
            instruction_category: InstructionCategory::Call,
            call_target_rva: Some(call_target_rva),
            xrefs: vec![crate::linear::InstructionXref {
                target_rva: call_target_rva,
                kind: XrefKind::Call,
                target_kind: XrefTargetKind::Code,
            }],
            ..instruction_row(start_rva, len)
        }
    }

    fn data_instruction_row(
        start_rva: u64,
        len: u8,
        data_target_rva: u64,
    ) -> AnalyzedInstructionRow {
        AnalyzedInstructionRow {
            xrefs: vec![crate::linear::InstructionXref {
                target_rva: data_target_rva,
                kind: XrefKind::Data,
                target_kind: XrefTargetKind::Data,
            }],
            ..instruction_row(start_rva, len)
        }
    }

    fn completed_function_analysis(
        function_start_rva: u64,
        function_rows: Vec<AnalyzedInstructionRow>,
    ) -> CompletedFunctionAnalysis {
        CompletedFunctionAnalysis {
            function_start_rva,
            cached_graph: CachedFunctionGraph {
                function_start_rva,
                function_name: format!("sub_{function_start_rva:x}"),
                blocks: Vec::new(),
                edges: Vec::new(),
                instruction_block_start_by_rva: HashMap::new(),
            },
            function_rows,
        }
    }

    #[test]
    fn instruction_owner_lookup_uses_range_end_exclusive() {
        let mut owners = BTreeMap::<u64, InstructionOwnerRange>::new();
        owners.insert(
            0x1000,
            InstructionOwnerRange {
                end_rva: 0x1002,
                function_start_rva: 0x1000,
            },
        );
        owners.insert(
            0x1010,
            InstructionOwnerRange {
                end_rva: 0x1014,
                function_start_rva: 0x1010,
            },
        );

        assert_eq!(instruction_owner_for_rva(&owners, 0x1000), Some(0x1000));
        assert_eq!(instruction_owner_for_rva(&owners, 0x1001), Some(0x1000));
        assert_eq!(instruction_owner_for_rva(&owners, 0x1002), None);
        assert_eq!(instruction_owner_for_rva(&owners, 0x100F), None);
        assert_eq!(instruction_owner_for_rva(&owners, 0x1013), Some(0x1010));
        assert_eq!(instruction_owner_for_rva(&owners, 0x1014), None);
    }

    #[test]
    fn instruction_range_overlap_detection() {
        let mut owners = BTreeMap::<u64, InstructionOwnerRange>::new();
        owners.insert(
            0x2000,
            InstructionOwnerRange {
                end_rva: 0x2004,
                function_start_rva: 0x2000,
            },
        );
        owners.insert(
            0x3000,
            InstructionOwnerRange {
                end_rva: 0x3008,
                function_start_rva: 0x3000,
            },
        );

        assert!(instruction_range_overlaps(&owners, 0x2001, 0x2003));
        assert!(!instruction_range_overlaps(&owners, 0x2004, 0x2020));
        assert!(!instruction_range_overlaps(&owners, 0x2FFC, 0x3000));
        assert!(instruction_range_overlaps(&owners, 0x3001, 0x3002));
        assert!(!instruction_range_overlaps(&owners, 0x2020, 0x2FFC));
    }

    #[test]
    fn merge_completed_function_analysis_keeps_first_canonical_owner() {
        let mut graphs_by_start = HashMap::new();
        let mut instruction_owner_by_rva = BTreeMap::new();
        let mut claimed_instructions = BTreeMap::new();
        let mut claimed_instructions_by_function_start = HashMap::new();

        merge_completed_function_analysis(
            completed_function_analysis(0x1000, vec![instruction_row(0x2000, 2)]),
            &mut graphs_by_start,
            &mut instruction_owner_by_rva,
            &mut claimed_instructions,
            &mut claimed_instructions_by_function_start,
        );
        merge_completed_function_analysis(
            completed_function_analysis(0x1010, vec![instruction_row(0x2001, 2)]),
            &mut graphs_by_start,
            &mut instruction_owner_by_rva,
            &mut claimed_instructions,
            &mut claimed_instructions_by_function_start,
        );

        assert_eq!(
            instruction_owner_for_rva(&instruction_owner_by_rva, 0x2000),
            Some(0x1000)
        );
        assert_eq!(
            instruction_owner_for_rva(&instruction_owner_by_rva, 0x2001),
            Some(0x1000)
        );
        assert_eq!(
            instruction_owner_for_rva(&instruction_owner_by_rva, 0x2002),
            None
        );
        assert_eq!(
            claimed_instructions_by_function_start
                .get(&0x1000)
                .map(Vec::len),
            Some(1)
        );
        assert_eq!(
            claimed_instructions_by_function_start
                .get(&0x1010)
                .map(Vec::len),
            None
        );
    }

    #[test]
    fn call_seed_priority_stays_below_static_provenance() {
        assert!(seed_priority("call") > seed_priority("exception"));
    }

    #[test]
    fn discover_call_target_seeds_registers_executable_targets() {
        let module_path = fixture_path("minimal_x64.exe");
        let bytes = fs::read(&module_path).expect("fixture bytes should load");
        let pe = parse_pe64(&bytes).expect("fixture should parse as PE64");
        let section_lookup = build_section_lookup(&pe);
        let image_base = pe.image_base as u64;
        let target_rva = section_lookup
            .sections()
            .iter()
            .find(|section| section.executable)
            .map(|section| section.start_rva)
            .expect("fixture should have an executable section");
        let completed =
            completed_function_analysis(0x1000, vec![call_instruction_row(0x2000, 5, target_rva)]);
        let mut ordered = BTreeMap::new();

        let changed = discover_call_target_seeds(
            &completed,
            image_base,
            &section_lookup,
            &mut ordered,
            &BTreeMap::new(),
        );

        assert!(changed);
        let seed = ordered
            .get(&target_rva)
            .expect("call target seed should be registered");
        assert_eq!(seed.seed.kind, "call");
        assert_eq!(seed.seed.name, format!("sub_{:x}", image_base + target_rva));
    }

    #[test]
    fn discover_call_target_seeds_skips_targets_owned_by_static_provenance() {
        let module_path = fixture_path("minimal_x64.exe");
        let bytes = fs::read(&module_path).expect("fixture bytes should load");
        let pe = parse_pe64(&bytes).expect("fixture should parse as PE64");
        let section_lookup = build_section_lookup(&pe);
        let image_base = pe.image_base as u64;
        let target_rva = section_lookup
            .sections()
            .iter()
            .find(|section| section.executable)
            .map(|section| section.start_rva)
            .expect("fixture should have an executable section");
        let completed =
            completed_function_analysis(0x1000, vec![call_instruction_row(0x2000, 5, target_rva)]);
        let mut ordered = BTreeMap::new();
        let mut non_call_owners = BTreeMap::new();
        claim_function_rows_for_owner(
            0x3000,
            &[instruction_row(target_rva, 4)],
            &mut non_call_owners,
        );

        let changed = discover_call_target_seeds(
            &completed,
            image_base,
            &section_lookup,
            &mut ordered,
            &non_call_owners,
        );

        assert!(!changed);
        assert!(!ordered.contains_key(&target_rva));
    }

    #[test]
    fn register_seed_keeps_stronger_existing_static_provenance() {
        let target_rva = 0x2000;
        let mut ordered = BTreeMap::new();

        assert!(register_seed(
            &mut ordered,
            FunctionSeedCandidate {
                seed: super::FunctionSeedEntry {
                    start_rva: target_rva,
                    name: "exported_name".to_owned(),
                    kind: "export",
                },
                priority: seed_priority("export"),
            },
        ));
        assert!(!register_seed(
            &mut ordered,
            FunctionSeedCandidate {
                seed: super::FunctionSeedEntry {
                    start_rva: target_rva,
                    name: "sub_call".to_owned(),
                    kind: "call",
                },
                priority: seed_priority("call"),
            },
        ));

        let seed = ordered
            .get(&target_rva)
            .expect("stronger static seed should remain registered");
        assert_eq!(seed.seed.kind, "export");
        assert_eq!(seed.seed.name, "exported_name");
    }

    #[test]
    fn build_xref_indexes_keeps_canonical_code_and_data_xrefs() {
        let mut claimed = HashMap::new();
        claimed.insert(
            0x1000,
            vec![
                call_instruction_row(0x1000, 5, 0x2000),
                data_instruction_row(0x1005, 7, 0x3000),
            ],
        );
        let owners = [(0x1000, 0x1005, 0x1000), (0x2000, 0x2004, 0x2000)]
            .into_iter()
            .map(|(start_rva, end_rva, function_start_rva)| {
                (
                    start_rva,
                    InstructionOwnerRange {
                        end_rva,
                        function_start_rva,
                    },
                )
            })
            .collect::<BTreeMap<_, _>>();

        let xrefs_to = build_xref_indexes(&claimed, &owners);

        assert_eq!(xrefs_to.get(&0x2000).map(Vec::len), Some(1));
        assert_eq!(xrefs_to.get(&0x3000).map(Vec::len), Some(1));

        assert_eq!(
            xrefs_to
                .get(&0x2000)
                .and_then(|xrefs| xrefs.first())
                .copied(),
            Some(CachedXref {
                source_instruction_rva: 0x1000,
                source_function_start_rva: 0x1000,
                target_rva: 0x2000,
                kind: XrefKind::Call,
                target_kind: XrefTargetKind::Code,
            })
        );
        assert_eq!(
            xrefs_to
                .get(&0x3000)
                .and_then(|xrefs| xrefs.first())
                .copied(),
            Some(CachedXref {
                source_instruction_rva: 0x1005,
                source_function_start_rva: 0x1000,
                target_rva: 0x3000,
                kind: XrefKind::Data,
                target_kind: XrefTargetKind::Data,
            })
        );
    }

    #[test]
    fn module_analysis_returns_canceled_when_requested_during_parallel_analysis() {
        let module_path = fixture_path("minimal_x64.exe");
        let bytes = fs::read(&module_path).expect("fixture bytes should load");
        let cancel_checks = AtomicUsize::new(0);

        let result = build_module_analysis_with_progress(
            &module_path,
            &bytes,
            |_| {},
            || cancel_checks.fetch_add(1, Ordering::Relaxed) >= 1,
        );

        assert!(matches!(result, Err(EngineError::Canceled)));
    }
}
