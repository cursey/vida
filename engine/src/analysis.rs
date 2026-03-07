use std::collections::{BTreeMap, HashMap};
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

use crate::api::{FunctionGraphBlock, FunctionGraphEdge, FunctionGraphInstruction};
use crate::cfg::{BasicBlockEdgeKind, FunctionGraphAnalysis, analyze_function_cfg};
use crate::disasm::{default_function_name, to_hex};
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
    pub(crate) instruction_owner_by_rva: BTreeMap<u64, InstructionOwnerRange>,
    pub(crate) claimed_instructions_by_function_start: HashMap<u64, Vec<AnalyzedInstructionRow>>,
}

#[derive(Debug, Clone)]
pub(crate) struct CachedFunctionGraph {
    pub(crate) function_start_rva: u64,
    pub(crate) function_name: String,
    pub(crate) blocks: Vec<FunctionGraphBlock>,
    pub(crate) edges: Vec<FunctionGraphEdge>,
    pub(crate) instruction_block_id_by_rva: HashMap<u64, String>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct InstructionOwnerRange {
    end_rva: u64,
    function_start_rva: u64,
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
    let functions = Arc::new(discover_function_seeds_with_progress(
        module_path,
        &pe,
        image_base,
        &section_lookup,
        &mut on_progress,
    )?);

    if is_canceled() {
        return Err(EngineError::Canceled);
    }

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
        let worker_count = analysis_worker_count(analysis_order.len());
        let next_index = AtomicUsize::new(0);
        let stop_requested = AtomicBool::new(false);
        let (sender, receiver) = mpsc::channel::<(
            usize,
            Result<Option<CompletedFunctionAnalysis>, EngineError>,
        )>();
        let mut pending_results = BTreeMap::<usize, Option<CompletedFunctionAnalysis>>::new();
        let mut first_error = None;
        let mut completed_count = 0usize;
        let mut next_merge_index = 0usize;

        thread::scope(|scope| {
            for _ in 0..worker_count {
                let sender = sender.clone();
                let analysis_order = &analysis_order;
                let next_index = &next_index;
                let stop_requested = &stop_requested;
                let section_lookup = &section_lookup;

                scope.spawn(move || {
                    loop {
                        if stop_requested.load(Ordering::Relaxed) {
                            break;
                        }

                        let index = next_index.fetch_add(1, Ordering::Relaxed);
                        if index >= analysis_order.len() {
                            break;
                        }

                        let result =
                            analyze_seed(bytes, section_lookup, image_base, &analysis_order[index]);
                        if result.is_err() {
                            stop_requested.store(true, Ordering::Relaxed);
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
                    stop_requested.store(true, Ordering::Relaxed);
                }

                match receiver.recv_timeout(ANALYSIS_RESULT_POLL_INTERVAL) {
                    Ok((index, result)) => {
                        completed_count += 1;
                        on_progress(AnalysisProgressUpdate {
                            phase: AnalysisProgressPhase::AnalyzingFunctions,
                            discovered_functions: Arc::clone(&functions),
                            total_function_count: Some(functions.len()),
                            analyzed_function_count: Some(completed_count),
                        });

                        match result {
                            Ok(completed) => {
                                pending_results.insert(index, completed);
                            }
                            Err(error) => {
                                stop_requested.store(true, Ordering::Relaxed);
                                if first_error.is_none() {
                                    first_error = Some(error);
                                }
                            }
                        }

                        if first_error.is_none() {
                            while let Some(completed) = pending_results.remove(&next_merge_index) {
                                if let Some(completed) = completed {
                                    merge_completed_function_analysis(
                                        completed,
                                        &mut graphs_by_start,
                                        &mut instruction_owner_by_rva,
                                        &mut claimed_instructions,
                                        &mut claimed_instructions_by_function_start,
                                    );
                                }
                                next_merge_index += 1;
                            }
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => continue,
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        if is_canceled() {
            return Err(EngineError::Canceled);
        }

        if let Some(error) = first_error {
            return Err(error);
        }

        while let Some(completed) = pending_results.remove(&next_merge_index) {
            if let Some(completed) = completed {
                merge_completed_function_analysis(
                    completed,
                    &mut graphs_by_start,
                    &mut instruction_owner_by_rva,
                    &mut claimed_instructions,
                    &mut claimed_instructions_by_function_start,
                );
            }
            next_merge_index += 1;
        }

        if next_merge_index != analysis_order.len() {
            return Err(EngineError::Internal(
                "Parallel function analysis produced incomplete results".to_owned(),
            ));
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

    Ok(ModuleAnalysis {
        functions: (*functions).clone(),
        linear_view,
        graphs_by_start,
        instruction_owner_by_rva,
        claimed_instructions_by_function_start,
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

fn analyze_seed(
    bytes: &[u8],
    section_lookup: &SectionLookup,
    image_base: u64,
    seed: &FunctionSeedEntry,
) -> Result<Option<CompletedFunctionAnalysis>, EngineError> {
    let analysis = match analyze_function_cfg(bytes, section_lookup, image_base, seed.start_rva) {
        Ok(analysis) => analysis,
        Err(EngineError::InvalidAddress) => return Ok(None),
        Err(error) => return Err(error),
    };

    let (cached_graph, function_rows) =
        build_cached_function_graph(analysis, image_base, seed.name.clone());
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
        let row_end_rva = row.start_rva.saturating_add(u64::from(row.len));
        if instruction_range_overlaps(instruction_owner_by_rva, row.start_rva, row_end_rva) {
            continue;
        }

        instruction_owner_by_rva.insert(
            row.start_rva,
            InstructionOwnerRange {
                end_rva: row_end_rva,
                function_start_rva: completed.function_start_rva,
            },
        );
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

fn discover_function_seeds_with_progress<F>(
    module_path: &Path,
    pe: &PE<'_>,
    image_base: u64,
    section_lookup: &SectionLookup,
    on_progress: &mut F,
) -> Result<Vec<FunctionSeedEntry>, EngineError>
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

    Ok(ordered
        .into_values()
        .map(|candidate| candidate.seed)
        .collect())
}

fn emit_discovery_progress<F>(ordered: &BTreeMap<u64, FunctionSeedCandidate>, on_progress: &mut F)
where
    F: FnMut(AnalysisProgressUpdate),
{
    on_progress(AnalysisProgressUpdate {
        phase: AnalysisProgressPhase::DiscoveringFunctions,
        discovered_functions: Arc::new(ordered.values().cloned().map(|value| value.seed).collect()),
        total_function_count: None,
        analyzed_function_count: None,
    });
}

fn register_seed(
    ordered: &mut BTreeMap<u64, FunctionSeedCandidate>,
    candidate: FunctionSeedCandidate,
) {
    match ordered.get(&candidate.seed.start_rva) {
        Some(existing) if existing.priority <= candidate.priority => {}
        _ => {
            ordered.insert(candidate.seed.start_rva, candidate);
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
        _ => u8::MAX,
    }
}

fn build_cached_function_graph(
    analysis: FunctionGraphAnalysis,
    image_base: u64,
    function_name: String,
) -> (CachedFunctionGraph, Vec<AnalyzedInstructionRow>) {
    let block_id_by_start_rva = analysis
        .blocks
        .iter()
        .map(|block| (block.start_rva, format!("b_{:X}", block.start_rva)))
        .collect::<HashMap<u64, String>>();

    let mut instruction_block_id_by_rva = HashMap::<u64, String>::new();
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
                        instruction_block_id_by_rva
                            .insert(instruction.start_rva + offset, block_id.clone());
                    }
                    linear_rows.push(AnalyzedInstructionRow {
                        start_rva: instruction.start_rva,
                        len: instruction.len,
                        bytes: instruction.bytes.clone(),
                        mnemonic: instruction.mnemonic.clone(),
                        operands: instruction.operands.clone(),
                        instruction_category: instruction.instruction_category,
                        branch_target_rva: instruction.branch_target_rva,
                        call_target_rva: instruction.call_target_rva,
                    });
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

    linear_rows.sort_by_key(|row| row.start_rva);

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

    (
        CachedFunctionGraph {
            function_start_rva: analysis.start_rva,
            function_name,
            blocks,
            edges,
            instruction_block_id_by_rva,
        },
        linear_rows,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        CachedFunctionGraph, CompletedFunctionAnalysis, InstructionOwnerRange,
        instruction_owner_for_rva, instruction_range_overlaps, merge_completed_function_analysis,
    };
    use crate::api::InstructionCategory;
    use crate::linear::AnalyzedInstructionRow;
    use std::collections::{BTreeMap, HashMap};

    fn instruction_row(start_rva: u64, len: u8) -> AnalyzedInstructionRow {
        AnalyzedInstructionRow {
            start_rva,
            len,
            bytes: "90".to_owned(),
            mnemonic: "nop".to_owned(),
            operands: String::new(),
            instruction_category: InstructionCategory::Other,
            branch_target_rva: None,
            call_target_rva: None,
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
                instruction_block_id_by_rva: HashMap::new(),
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
}
