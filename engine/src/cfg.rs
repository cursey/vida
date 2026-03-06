use std::collections::{BTreeMap, BTreeSet, HashSet, VecDeque};

use goblin::pe::PE;
use iced_x86::{
    Decoder, DecoderOptions, FlowControl, Formatter, Instruction, IntelFormatter, Mnemonic,
};

use crate::disasm::{categorize_instruction, split_instruction_text};
use crate::error::EngineError;
use crate::pe_utils::{find_section_for_rva, get_byte_at_rva};
use crate::protocol::InstructionCategory;

pub(crate) const MAX_CFG_BLOCKS: usize = 2048;
pub(crate) const MAX_CFG_INSTRUCTIONS: usize = 65_536;

#[derive(Debug, Clone)]
pub(crate) struct FunctionGraphAnalysis {
    pub(crate) start_rva: u64,
    pub(crate) blocks: Vec<BasicBlockAnalysis>,
    pub(crate) edges: Vec<BasicBlockEdgeAnalysis>,
    pub(crate) instruction_starts: HashSet<u64>,
}

#[derive(Debug, Clone)]
pub(crate) struct BasicBlockAnalysis {
    pub(crate) start_rva: u64,
    pub(crate) instructions: Vec<BasicBlockInstructionAnalysis>,
}

#[derive(Debug, Clone)]
pub(crate) struct BasicBlockInstructionAnalysis {
    pub(crate) start_rva: u64,
    pub(crate) mnemonic: String,
    pub(crate) operands: String,
    pub(crate) instruction_category: InstructionCategory,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum BasicBlockEdgeKind {
    Conditional,
    Unconditional,
    Fallthrough,
}

#[derive(Debug, Clone)]
pub(crate) struct BasicBlockEdgeAnalysis {
    pub(crate) from_rva: u64,
    pub(crate) to_rva: u64,
    pub(crate) kind: BasicBlockEdgeKind,
}

#[derive(Debug)]
struct DecodedInstruction {
    len: u8,
    mnemonic: String,
    operands: String,
    instruction_category: InstructionCategory,
    flow_control: FlowControl,
    branch_target_rva: Option<u64>,
}

pub(crate) fn analyze_function_cfg(
    bytes: &[u8],
    pe: &PE<'_>,
    start_rva: u64,
) -> Result<FunctionGraphAnalysis, EngineError> {
    let section = find_section_for_rva(pe, start_rva).ok_or(EngineError::InvalidAddress)?;
    let image_base = pe.image_base as u64;

    let in_section = |rva: u64| rva >= section.start_rva && rva < section.end_rva;

    let mut queue = VecDeque::new();
    let mut enqueued = BTreeSet::new();
    queue.push_back(start_rva);
    enqueued.insert(start_rva);

    let mut blocks = BTreeMap::<u64, BasicBlockAnalysis>::new();
    let mut edge_set = BTreeSet::<(u64, u64, BasicBlockEdgeKind)>::new();
    let mut instruction_starts = HashSet::<u64>::new();
    let mut total_instructions = 0usize;

    while let Some(block_start) = queue.pop_front() {
        if blocks.contains_key(&block_start) {
            continue;
        }
        if !in_section(block_start) {
            continue;
        }
        if blocks.len() >= MAX_CFG_BLOCKS || total_instructions >= MAX_CFG_INSTRUCTIONS {
            break;
        }

        let mut current_rva = block_start;
        let mut instructions = Vec::<BasicBlockInstructionAnalysis>::new();

        loop {
            if total_instructions >= MAX_CFG_INSTRUCTIONS || !in_section(current_rva) {
                break;
            }

            if current_rva != block_start && enqueued.contains(&current_rva) {
                edge_set.insert((block_start, current_rva, BasicBlockEdgeKind::Fallthrough));
                break;
            }

            let Some(decoded) =
                decode_instruction_at_rva(bytes, pe, image_base, current_rva, section.end_rva)?
            else {
                break;
            };

            instruction_starts.insert(current_rva);
            instructions.push(BasicBlockInstructionAnalysis {
                start_rva: current_rva,
                mnemonic: decoded.mnemonic,
                operands: decoded.operands,
                instruction_category: decoded.instruction_category,
            });
            total_instructions += 1;

            let next_rva = current_rva.saturating_add(u64::from(decoded.len));
            match decoded.flow_control {
                FlowControl::Return => break,
                FlowControl::UnconditionalBranch | FlowControl::IndirectBranch => {
                    if let Some(target_rva) =
                        decoded.branch_target_rva.filter(|value| in_section(*value))
                    {
                        edge_set.insert((
                            block_start,
                            target_rva,
                            BasicBlockEdgeKind::Unconditional,
                        ));
                        if enqueued.insert(target_rva) {
                            queue.push_back(target_rva);
                        }
                    }
                    break;
                }
                FlowControl::ConditionalBranch => {
                    if let Some(target_rva) =
                        decoded.branch_target_rva.filter(|value| in_section(*value))
                    {
                        edge_set.insert((block_start, target_rva, BasicBlockEdgeKind::Conditional));
                        if enqueued.insert(target_rva) {
                            queue.push_back(target_rva);
                        }
                    }
                    if in_section(next_rva) {
                        edge_set.insert((block_start, next_rva, BasicBlockEdgeKind::Fallthrough));
                        if enqueued.insert(next_rva) {
                            queue.push_back(next_rva);
                        }
                    }
                    break;
                }
                _ => {
                    if !in_section(next_rva) {
                        break;
                    }
                    current_rva = next_rva;
                }
            }
        }

        if !instructions.is_empty() {
            blocks.insert(
                block_start,
                BasicBlockAnalysis {
                    start_rva: block_start,
                    instructions,
                },
            );
        }
    }

    if blocks.is_empty() {
        return Err(EngineError::InvalidAddress);
    }

    let block_starts = blocks.keys().copied().collect::<BTreeSet<u64>>();
    let edges = edge_set
        .into_iter()
        .filter(|(from_rva, to_rva, _)| {
            block_starts.contains(from_rva) && block_starts.contains(to_rva)
        })
        .map(|(from_rva, to_rva, kind)| BasicBlockEdgeAnalysis {
            from_rva,
            to_rva,
            kind,
        })
        .collect::<Vec<BasicBlockEdgeAnalysis>>();

    Ok(FunctionGraphAnalysis {
        start_rva,
        blocks: blocks.into_values().collect(),
        edges,
        instruction_starts,
    })
}

fn decode_instruction_at_rva(
    bytes: &[u8],
    pe: &PE<'_>,
    image_base: u64,
    rva: u64,
    section_end_rva: u64,
) -> Result<Option<DecodedInstruction>, EngineError> {
    if rva >= section_end_rva {
        return Ok(None);
    }

    let window_len = usize::try_from((section_end_rva - rva).min(15))
        .map_err(|error| EngineError::Internal(error.to_string()))?;
    if window_len == 0 {
        return Ok(None);
    }

    let mut decode_window = Vec::with_capacity(window_len);
    for offset in 0..window_len {
        decode_window.push(get_byte_at_rva(bytes, pe, rva + offset as u64));
    }

    let mut decoder = Decoder::with_ip(64, &decode_window, image_base + rva, DecoderOptions::NONE);
    let mut instruction = Instruction::default();
    decoder.decode_out(&mut instruction);

    if instruction.mnemonic() == Mnemonic::INVALID
        || instruction.len() == 0
        || instruction.len() as usize > window_len
    {
        return Ok(None);
    }

    let mut formatter = IntelFormatter::new();
    let mut instruction_text = String::new();
    formatter.format(&instruction, &mut instruction_text);
    let (mnemonic, operands) = split_instruction_text(&instruction_text);
    let instruction_category = categorize_instruction(&instruction, &mnemonic);

    let branch_target_rva = match instruction.flow_control() {
        FlowControl::ConditionalBranch | FlowControl::UnconditionalBranch => {
            let target_va = instruction.near_branch_target();
            if target_va < image_base {
                None
            } else {
                Some(target_va - image_base)
            }
        }
        _ => None,
    };

    Ok(Some(DecodedInstruction {
        len: instruction.len().min(u8::MAX as usize) as u8,
        mnemonic,
        operands,
        instruction_category,
        flow_control: instruction.flow_control(),
        branch_target_rva,
    }))
}
