use iced_x86::{FlowControl, Instruction};

use crate::api::InstructionCategory;
use crate::error::EngineError;

pub(crate) fn split_instruction_text(text: &str) -> (String, String) {
    let trimmed = text.trim();
    if let Some((mnemonic, operands)) = trimmed.split_once(' ') {
        return (mnemonic.to_owned(), operands.trim().to_owned());
    }
    (trimmed.to_owned(), String::new())
}

pub(crate) fn categorize_instruction(
    instruction: &Instruction,
    mnemonic: &str,
) -> InstructionCategory {
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

    let normalized = mnemonic.trim().to_ascii_lowercase();

    if matches_mnemonic_prefix(
        &normalized,
        &[
            "cmp", "test", "ucomi", "comi", "vtest", "ptest", "scas", "cmps",
        ],
    ) {
        return InstructionCategory::CompareTest;
    }

    if matches_mnemonic_prefix(
        &normalized,
        &[
            "add", "sub", "mul", "imul", "div", "idiv", "inc", "dec", "neg", "adc", "sbb",
        ],
    ) {
        return InstructionCategory::Arithmetic;
    }

    if matches_mnemonic_prefix(&normalized, &["and", "or", "xor", "not", "andn"]) {
        return InstructionCategory::Logic;
    }

    if matches_mnemonic_prefix(
        &normalized,
        &[
            "shl", "shr", "sar", "sal", "rol", "ror", "rcl", "rcr", "shld", "shrd",
        ],
    ) {
        return InstructionCategory::BitShift;
    }

    if matches_mnemonic_prefix(
        &normalized,
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

pub(crate) fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<String>>()
        .join(" ")
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

pub(crate) fn default_function_name(va: u64) -> String {
    format!("sub_{va:x}")
}
