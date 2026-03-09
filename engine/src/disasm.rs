use iced_x86::{Decoder, DecoderOptions, FlowControl, Formatter, Instruction, Mnemonic};
use std::collections::HashMap;

use crate::api::InstructionCategory;
use crate::error::EngineError;
use crate::pe_utils::SectionLookup;

use std::fmt::Write as FmtWrite;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RenderedInstruction {
    pub(crate) bytes: Option<String>,
    pub(crate) mnemonic: String,
    pub(crate) operands: String,
}

pub(crate) fn split_instruction_text(text: &str) -> (String, String) {
    let trimmed = text.trim();
    if let Some((mnemonic, operands)) = trimmed.split_once(' ') {
        return (mnemonic.to_owned(), operands.trim().to_owned());
    }
    (trimmed.to_owned(), String::new())
}

pub(crate) fn categorize_instruction(instruction: &Instruction) -> InstructionCategory {
    match instruction.flow_control() {
        FlowControl::Call | FlowControl::IndirectCall => return InstructionCategory::Call,
        FlowControl::Return => return InstructionCategory::Return,
        FlowControl::ConditionalBranch
        | FlowControl::UnconditionalBranch
        | FlowControl::IndirectBranch
        | FlowControl::XbeginXabortXend => return InstructionCategory::ControlFlow,
        _ => {}
    }

    if instruction.is_privileged()
        || matches!(
            instruction.flow_control(),
            FlowControl::Interrupt | FlowControl::Exception
        )
    {
        return InstructionCategory::System;
    }

    if instruction.is_stack_instruction() {
        return InstructionCategory::Stack;
    }

    if instruction.is_string_instruction() {
        return InstructionCategory::String;
    }

    match instruction.mnemonic() {
        Mnemonic::Cmp | Mnemonic::Test => return InstructionCategory::CompareTest,
        Mnemonic::Add
        | Mnemonic::Sub
        | Mnemonic::Mul
        | Mnemonic::Imul
        | Mnemonic::Div
        | Mnemonic::Idiv
        | Mnemonic::Inc
        | Mnemonic::Dec
        | Mnemonic::Neg
        | Mnemonic::Adc
        | Mnemonic::Sbb => return InstructionCategory::Arithmetic,
        Mnemonic::And | Mnemonic::Or | Mnemonic::Xor | Mnemonic::Not | Mnemonic::Andn => {
            return InstructionCategory::Logic;
        }
        Mnemonic::Shl
        | Mnemonic::Shr
        | Mnemonic::Sar
        | Mnemonic::Sal
        | Mnemonic::Rol
        | Mnemonic::Ror
        | Mnemonic::Rcl
        | Mnemonic::Rcr
        | Mnemonic::Shld
        | Mnemonic::Shrd => return InstructionCategory::BitShift,
        _ => {}
    }

    let normalized_mnemonic = format!("{:?}", instruction.mnemonic()).to_ascii_lowercase();
    if matches_mnemonic_prefix(
        &normalized_mnemonic,
        &[
            "cmp", "test", "ucomi", "comi", "vtest", "ptest", "scas", "cmps",
        ],
    ) {
        return InstructionCategory::CompareTest;
    }

    if matches_mnemonic_prefix(
        &normalized_mnemonic,
        &[
            "add", "sub", "mul", "imul", "div", "idiv", "inc", "dec", "neg", "adc", "sbb",
        ],
    ) {
        return InstructionCategory::Arithmetic;
    }

    if matches_mnemonic_prefix(&normalized_mnemonic, &["and", "or", "xor", "not", "andn"]) {
        return InstructionCategory::Logic;
    }

    if matches_mnemonic_prefix(
        &normalized_mnemonic,
        &[
            "shl", "shr", "sar", "sal", "rol", "ror", "rcl", "rcr", "shld", "shrd",
        ],
    ) {
        return InstructionCategory::BitShift;
    }

    if matches_mnemonic_prefix(
        &normalized_mnemonic,
        &[
            "mov", "cmov", "xchg", "xadd", "lea", "set", "bswap", "prefetch", "in", "out", "lods",
            "stos", "lds", "les", "lfs", "lgs", "lss", "kmov", "vmov",
        ],
    ) {
        return InstructionCategory::DataTransfer;
    }

    InstructionCategory::Other
}

fn matches_mnemonic_prefix(value: &str, prefixes: &[&str]) -> bool {
    prefixes
        .iter()
        .any(|prefix| value == *prefix || value.starts_with(prefix))
}

pub(crate) fn render_instruction(
    bytes: &[u8],
    section_lookup: &SectionLookup,
    image_base: u64,
    start_rva: u64,
    len: u8,
    include_bytes: bool,
    function_names_by_start_rva: &HashMap<u64, String>,
) -> Result<RenderedInstruction, EngineError> {
    if len == 0 {
        return Err(EngineError::Internal(
            "Instruction render requested with zero length".to_owned(),
        ));
    }

    let mut decode_window = vec![0u8; len as usize];
    for (index, byte) in decode_window.iter_mut().enumerate() {
        *byte = section_lookup.get_byte_at(bytes, start_rva + index as u64);
    }

    let mut decoder = Decoder::with_ip(
        64,
        &decode_window,
        image_base + start_rva,
        DecoderOptions::NONE,
    );
    let mut instruction = Instruction::default();
    decoder.decode_out(&mut instruction);

    if instruction.mnemonic() == Mnemonic::INVALID
        || instruction.len() == 0
        || instruction.len() as u8 != len
    {
        return Err(EngineError::Internal(format!(
            "Failed to lazily render instruction at RVA 0x{start_rva:X}"
        )));
    }

    let mut formatter = iced_x86::IntelFormatter::new();
    let mut instruction_text = String::new();
    Formatter::format(&mut formatter, &instruction, &mut instruction_text);
    let (mnemonic, operands) = split_instruction_text(&instruction_text);
    let operands = symbolize_operand_text(
        &instruction,
        image_base,
        operands,
        function_names_by_start_rva,
    );

    Ok(RenderedInstruction {
        bytes: include_bytes.then(|| bytes_to_hex(&decode_window)),
        mnemonic,
        operands,
    })
}

pub(crate) fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len().saturating_mul(3).saturating_sub(1));

    for (index, byte) in bytes.iter().enumerate() {
        if index > 0 {
            output.push(' ');
        }
        let _ = write!(&mut output, "{byte:02X}");
    }

    output
}

pub(crate) fn parse_hex_u64(value: &str) -> Result<u64, EngineError> {
    let trimmed = value.trim();
    let no_prefix = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .ok_or(EngineError::InvalidAddress)?;
    u64::from_str_radix(no_prefix, 16).map_err(|_| EngineError::InvalidAddress)
}

pub(crate) fn to_hex(value: u64) -> String {
    format!("0x{value:X}")
}

pub(crate) fn symbolize_operand_text(
    instruction: &Instruction,
    image_base: u64,
    operands: String,
    function_names_by_start_rva: &HashMap<u64, String>,
) -> String {
    match instruction.flow_control() {
        FlowControl::Call => {
            let target_va = instruction.near_branch_target();
            if target_va < image_base {
                return operands;
            }

            function_names_by_start_rva
                .get(&(target_va - image_base))
                .cloned()
                .unwrap_or(operands)
        }
        FlowControl::ConditionalBranch | FlowControl::UnconditionalBranch => {
            let target_va = instruction.near_branch_target();
            if target_va < image_base {
                return operands;
            }

            default_label_name(target_va)
        }
        _ => operands,
    }
}

pub(crate) fn default_function_name(va: u64) -> String {
    format!("sub_{va:x}")
}

pub(crate) fn default_label_name(va: u64) -> String {
    format!("lbl_{va:x}")
}
