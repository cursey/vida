use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::Arc;

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
    pub(crate) instruction_owner_by_rva: HashMap<u64, u64>,
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
    let mut instruction_owner_by_rva = HashMap::<u64, u64>::new();
    let mut claimed_instructions = BTreeMap::<u64, AnalyzedInstructionRow>::new();
    let mut claimed_instructions_by_function_start =
        HashMap::<u64, Vec<AnalyzedInstructionRow>>::new();

    for (index, seed) in analysis_order.iter().enumerate() {
        if is_canceled() {
            return Err(EngineError::Canceled);
        }

        let analysis =
            match analyze_function_cfg(bytes, &section_lookup, image_base, seed.start_rva) {
                Ok(analysis) => analysis,
                Err(EngineError::InvalidAddress) => {
                    on_progress(AnalysisProgressUpdate {
                        phase: AnalysisProgressPhase::AnalyzingFunctions,
                        discovered_functions: Arc::clone(&functions),
                        total_function_count: Some(functions.len()),
                        analyzed_function_count: Some(index + 1),
                    });
                    continue;
                }
                Err(error) => return Err(error),
            };

        let (cached_graph, function_rows) =
            build_cached_function_graph(analysis, image_base, seed.name.clone());
        for row in function_rows {
            let mut has_overlap = false;
            for offset in 0..u64::from(row.len) {
                if instruction_owner_by_rva.contains_key(&(row.start_rva + offset)) {
                    has_overlap = true;
                    break;
                }
            }
            if has_overlap {
                continue;
            }

            for offset in 0..u64::from(row.len) {
                let covered_rva = row.start_rva + offset;
                instruction_owner_by_rva.insert(covered_rva, seed.start_rva);
            }
            claimed_instructions
                .entry(row.start_rva)
                .or_insert_with(|| row.clone());
            claimed_instructions_by_function_start
                .entry(seed.start_rva)
                .or_default()
                .push(row);
        }
        graphs_by_start.insert(seed.start_rva, cached_graph);
        on_progress(AnalysisProgressUpdate {
            phase: AnalysisProgressPhase::AnalyzingFunctions,
            discovered_functions: Arc::clone(&functions),
            total_function_count: Some(functions.len()),
            analyzed_function_count: Some(index + 1),
        });
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
