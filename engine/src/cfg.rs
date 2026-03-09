use std::collections::{BTreeMap, BTreeSet, VecDeque};

use iced_x86::{Decoder, DecoderOptions, FlowControl, Instruction, Mnemonic};

use crate::api::{InstructionCategory, XrefKind, XrefTargetKind};
use crate::disasm::categorize_instruction;
use crate::error::EngineError;
use crate::linear::InstructionXref;
use crate::pe_utils::SectionLookup;

pub(crate) const MAX_CFG_BLOCKS: usize = 2048;
pub(crate) const MAX_CFG_INSTRUCTIONS: usize = 65_536;

#[derive(Debug, Clone)]
pub(crate) struct FunctionGraphAnalysis {
    pub(crate) start_rva: u64,
    pub(crate) blocks: Vec<BasicBlockAnalysis>,
    pub(crate) edges: Vec<BasicBlockEdgeAnalysis>,
}

#[derive(Debug, Clone)]
pub(crate) struct BasicBlockAnalysis {
    pub(crate) start_rva: u64,
    pub(crate) instructions: Vec<BasicBlockInstructionAnalysis>,
}

#[derive(Debug, Clone)]
pub(crate) struct BasicBlockInstructionAnalysis {
    pub(crate) start_rva: u64,
    pub(crate) len: u8,
    pub(crate) instruction_category: InstructionCategory,
    pub(crate) branch_target_rva: Option<u64>,
    pub(crate) call_target_rva: Option<u64>,
    pub(crate) xrefs: Vec<InstructionXref>,
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
    pub(crate) source_instruction_rva: u64,
    pub(crate) kind: BasicBlockEdgeKind,
}

#[derive(Debug)]
struct DecodedInstruction {
    len: u8,
    instruction_category: InstructionCategory,
    flow_control: FlowControl,
    branch_target_rva: Option<u64>,
    call_target_rva: Option<u64>,
    xrefs: Vec<InstructionXref>,
}

pub(crate) fn analyze_function_cfg(
    bytes: &[u8],
    section_lookup: &SectionLookup,
    image_base: u64,
    start_rva: u64,
    mut is_canceled: impl FnMut() -> bool,
) -> Result<FunctionGraphAnalysis, EngineError> {
    if !section_lookup.is_executable_rva(start_rva) {
        return Err(EngineError::InvalidAddress);
    }

    let mut queue = VecDeque::new();
    let mut enqueued = BTreeSet::new();
    queue.push_back(start_rva);
    enqueued.insert(start_rva);

    let mut blocks = BTreeMap::<u64, BasicBlockAnalysis>::new();
    let mut edge_set = BTreeSet::<(u64, u64, u64, BasicBlockEdgeKind)>::new();
    let mut total_instructions = 0usize;

    while let Some(block_start) = queue.pop_front() {
        if is_canceled() {
            return Err(EngineError::Canceled);
        }
        if blocks.contains_key(&block_start) {
            continue;
        }
        if !section_lookup.is_executable_rva(block_start) {
            continue;
        }
        if blocks.len() >= MAX_CFG_BLOCKS || total_instructions >= MAX_CFG_INSTRUCTIONS {
            break;
        }

        let mut current_rva = block_start;
        let mut instructions = Vec::<BasicBlockInstructionAnalysis>::new();
        let mut previous_instruction_rva = None;

        loop {
            if is_canceled() {
                return Err(EngineError::Canceled);
            }
            if total_instructions >= MAX_CFG_INSTRUCTIONS
                || !section_lookup.is_executable_rva(current_rva)
            {
                break;
            }

            if current_rva != block_start && enqueued.contains(&current_rva) {
                if let Some(source_instruction_rva) = previous_instruction_rva {
                    edge_set.insert((
                        block_start,
                        current_rva,
                        source_instruction_rva,
                        BasicBlockEdgeKind::Fallthrough,
                    ));
                }
                break;
            }

            let Some(decoded) =
                decode_instruction_at_rva(bytes, section_lookup, image_base, current_rva)?
            else {
                break;
            };

            instructions.push(BasicBlockInstructionAnalysis {
                start_rva: current_rva,
                len: decoded.len,
                instruction_category: decoded.instruction_category,
                branch_target_rva: decoded.branch_target_rva,
                call_target_rva: decoded.call_target_rva,
                xrefs: decoded.xrefs,
            });
            total_instructions += 1;
            previous_instruction_rva = Some(current_rva);

            let next_rva = current_rva.saturating_add(u64::from(decoded.len));
            match decoded.flow_control {
                FlowControl::Return => break,
                FlowControl::UnconditionalBranch | FlowControl::IndirectBranch => {
                    if let Some(target_rva) = decoded
                        .branch_target_rva
                        .filter(|value| section_lookup.is_executable_rva(*value))
                    {
                        edge_set.insert((
                            block_start,
                            target_rva,
                            current_rva,
                            BasicBlockEdgeKind::Unconditional,
                        ));
                        if enqueued.insert(target_rva) {
                            queue.push_back(target_rva);
                        }
                    }
                    break;
                }
                FlowControl::ConditionalBranch => {
                    if let Some(target_rva) = decoded
                        .branch_target_rva
                        .filter(|value| section_lookup.is_executable_rva(*value))
                    {
                        edge_set.insert((
                            block_start,
                            target_rva,
                            current_rva,
                            BasicBlockEdgeKind::Conditional,
                        ));
                        if enqueued.insert(target_rva) {
                            queue.push_back(target_rva);
                        }
                    }
                    if section_lookup.is_executable_rva(next_rva) {
                        edge_set.insert((
                            block_start,
                            next_rva,
                            current_rva,
                            BasicBlockEdgeKind::Fallthrough,
                        ));
                        if enqueued.insert(next_rva) {
                            queue.push_back(next_rva);
                        }
                    }
                    break;
                }
                _ => {
                    if !section_lookup.is_executable_rva(next_rva) {
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
        .filter(|(from_rva, to_rva, _, _)| {
            block_starts.contains(from_rva) && block_starts.contains(to_rva)
        })
        .map(
            |(from_rva, to_rva, source_instruction_rva, kind)| BasicBlockEdgeAnalysis {
                from_rva,
                to_rva,
                source_instruction_rva,
                kind,
            },
        )
        .collect::<Vec<BasicBlockEdgeAnalysis>>();

    Ok(FunctionGraphAnalysis {
        start_rva,
        blocks: blocks.into_values().collect(),
        edges,
    })
}

fn decode_instruction_at_rva(
    bytes: &[u8],
    section_lookup: &SectionLookup,
    image_base: u64,
    rva: u64,
) -> Result<Option<DecodedInstruction>, EngineError> {
    let Some(section) = section_lookup.section_for_rva(rva) else {
        return Err(EngineError::InvalidAddress);
    };
    if !section.executable || rva >= section.end_rva {
        return Ok(None);
    }

    let section_end_rva = section.end_rva;
    let window_len = usize::try_from((section_end_rva - rva).min(15))
        .map_err(|error| EngineError::Internal(error.to_string()))?;
    if window_len == 0 {
        return Ok(None);
    }

    let mut decode_window = [0u8; 15];
    for offset in 0..window_len {
        decode_window[offset] = section_lookup.get_byte_at(bytes, rva + offset as u64);
    }

    let mut decoder = Decoder::with_ip(
        64,
        &decode_window[..window_len],
        image_base + rva,
        DecoderOptions::NONE,
    );
    let mut instruction = Instruction::default();
    decoder.decode_out(&mut instruction);

    if instruction.mnemonic() == Mnemonic::INVALID
        || instruction.len() == 0
        || instruction.len() as usize > window_len
    {
        return Ok(None);
    }

    let instruction_category = categorize_instruction(&instruction);

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
    let call_target_rva = match instruction.flow_control() {
        FlowControl::Call => {
            let target_va = instruction.near_branch_target();
            if target_va < image_base {
                None
            } else {
                Some(target_va - image_base)
            }
        }
        _ => None,
    };
    let mut xrefs = Vec::new();
    if let Some(target_rva) =
        call_target_rva.filter(|target| section_lookup.has_mapped_rva(*target))
    {
        xrefs.push(InstructionXref {
            target_rva,
            kind: XrefKind::Call,
            target_kind: XrefTargetKind::Code,
        });
    }
    if let Some(target_rva) =
        branch_target_rva.filter(|target| section_lookup.has_mapped_rva(*target))
    {
        let kind = match instruction.flow_control() {
            FlowControl::UnconditionalBranch => XrefKind::Jump,
            FlowControl::ConditionalBranch => XrefKind::Branch,
            _ => unreachable!("branch target only exists for direct branch flow control"),
        };
        xrefs.push(InstructionXref {
            target_rva,
            kind,
            target_kind: XrefTargetKind::Code,
        });
    }
    if instruction.is_ip_rel_memory_operand() {
        let target_va = instruction.ip_rel_memory_address();
        if target_va >= image_base {
            let target_rva = target_va - image_base;
            if section_lookup.has_mapped_rva(target_rva) {
                xrefs.push(InstructionXref {
                    target_rva,
                    kind: XrefKind::Data,
                    target_kind: XrefTargetKind::Data,
                });
            }
        }
    }

    Ok(Some(DecodedInstruction {
        len: instruction.len().min(u8::MAX as usize) as u8,
        instruction_category,
        flow_control: instruction.flow_control(),
        branch_target_rva,
        call_target_rva,
        xrefs,
    }))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::analyze_function_cfg;
    use crate::EngineError;
    use crate::fixture_path;
    use crate::pe_utils::{build_section_lookup, parse_pe64};

    #[test]
    fn function_cfg_analysis_honors_cancellation() {
        let fixture = fixture_path("minimal_x64.exe");
        let bytes = fs::read(&fixture).expect("fixture bytes should load");
        let pe = parse_pe64(bytes.as_slice()).expect("fixture should parse as PE64");
        let section_lookup = build_section_lookup(&pe);
        let image_base = pe.image_base as u64;
        let start_rva = pe.entry as u64;
        let mut poll_count = 0usize;

        let result = analyze_function_cfg(
            bytes.as_slice(),
            &section_lookup,
            image_base,
            start_rva,
            || {
                poll_count += 1;
                poll_count > 1
            },
        );

        assert!(matches!(result, Err(EngineError::Canceled)));
    }
}
