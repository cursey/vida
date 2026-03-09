use crate::api::InstructionCategory;
use crate::disasm::{
    categorize_instruction, parse_hex_u64, split_instruction_text, symbolize_operand_text,
};
use crate::pe_utils::{
    collect_exception_function_starts_from_entries, collect_tls_callback_starts_from_vas,
    is_valid_exception_function_range,
};
use crate::{EngineError, EngineState};
use goblin::pe::exception::RuntimeFunction;
use iced_x86::{Decoder, DecoderOptions, Formatter, Instruction};
use std::collections::HashMap;

fn decode_instruction(bytes: &[u8]) -> Instruction {
    let mut decoder = Decoder::with_ip(64, bytes, 0x140001000, DecoderOptions::NONE);
    let mut instruction = Instruction::default();
    decoder.decode_out(&mut instruction);
    instruction
}

fn instruction_operands(instruction: &Instruction) -> String {
    let mut formatter = iced_x86::IntelFormatter::new();
    let mut instruction_text = String::new();
    Formatter::format(&mut formatter, instruction, &mut instruction_text);
    let (_, operands) = split_instruction_text(&instruction_text);
    operands
}

#[test]
fn parses_hex_addresses() {
    assert_eq!(parse_hex_u64("0x10").expect("valid"), 16);
    assert!(parse_hex_u64("10").is_err());
}

#[test]
fn missing_module_reports_not_found() {
    let mut state = EngineState::default();
    let result = state.get_module_info(crate::api::ModuleInfoParams {
        module_id: "m404".to_owned(),
    });

    assert!(matches!(result, Err(EngineError::ModuleNotFound)));
}

#[test]
fn validates_exception_function_ranges() {
    assert!(!is_valid_exception_function_range(0, 0x1100));
    assert!(!is_valid_exception_function_range(0x1200, 0x1200));
    assert!(!is_valid_exception_function_range(0x1300, 0x1200));
    assert!(is_valid_exception_function_range(0x1400, 0x1410));
}

#[test]
fn collects_exception_starts_with_exec_filtering() {
    let entries = vec![
        RuntimeFunction {
            begin_address: 0,
            end_address: 0x1100,
            unwind_info_address: 0,
        },
        RuntimeFunction {
            begin_address: 0x1200,
            end_address: 0x1200,
            unwind_info_address: 0,
        },
        RuntimeFunction {
            begin_address: 0x1300,
            end_address: 0x1310,
            unwind_info_address: 0,
        },
        RuntimeFunction {
            begin_address: 0x1400,
            end_address: 0x1420,
            unwind_info_address: 0,
        },
    ];

    let starts = collect_exception_function_starts_from_entries(&entries, |rva| rva == 0x1400);
    assert_eq!(starts, vec![0x1400]);
}

#[test]
fn collects_tls_callbacks_with_image_base_and_exec_filtering() {
    let callbacks = vec![0x140001000, 0x140001080, 0x140001000, 0x13FFF0000];
    let starts = collect_tls_callback_starts_from_vas(&callbacks, 0x140000000, |rva| {
        matches!(rva, 0x1000 | 0x1080)
    });
    assert_eq!(starts, vec![0x1000, 0x1080]);
}

#[test]
fn categorizes_flow_control_before_stack() {
    let call = decode_instruction(&[0xE8, 0x00, 0x00, 0x00, 0x00]);
    assert_eq!(categorize_instruction(&call), InstructionCategory::Call);

    let ret = decode_instruction(&[0xC3]);
    assert_eq!(categorize_instruction(&ret), InstructionCategory::Return);

    let jmp = decode_instruction(&[0xEB, 0x00]);
    assert_eq!(
        categorize_instruction(&jmp),
        InstructionCategory::ControlFlow
    );
}

#[test]
fn categorizes_system_stack_and_mnemonic_groups() {
    let int3 = decode_instruction(&[0xCC]);
    assert_eq!(categorize_instruction(&int3), InstructionCategory::System);

    let push = decode_instruction(&[0x50]);
    assert_eq!(categorize_instruction(&push), InstructionCategory::Stack);

    let movs = decode_instruction(&[0xA4]);
    assert_eq!(categorize_instruction(&movs), InstructionCategory::String);

    let cmp = decode_instruction(&[0x3B, 0xC0]);
    assert_eq!(
        categorize_instruction(&cmp),
        InstructionCategory::CompareTest
    );

    let add = decode_instruction(&[0x01, 0xD8]);
    assert_eq!(
        categorize_instruction(&add),
        InstructionCategory::Arithmetic
    );

    let and = decode_instruction(&[0x21, 0xD8]);
    assert_eq!(categorize_instruction(&and), InstructionCategory::Logic);

    let shr = decode_instruction(&[0xD1, 0xE8]);
    assert_eq!(categorize_instruction(&shr), InstructionCategory::BitShift);

    let mov = decode_instruction(&[0x89, 0xD8]);
    assert_eq!(
        categorize_instruction(&mov),
        InstructionCategory::DataTransfer
    );

    let nop = decode_instruction(&[0x90]);
    assert_eq!(categorize_instruction(&nop), InstructionCategory::Other);
}

#[test]
fn categorizes_mnemonic_families_without_eager_instruction_text() {
    let movzx = decode_instruction(&[0x0F, 0xB6, 0xC0]);
    assert_eq!(
        categorize_instruction(&movzx),
        InstructionCategory::DataTransfer
    );

    let cmovne = decode_instruction(&[0x0F, 0x45, 0xC0]);
    assert_eq!(
        categorize_instruction(&cmovne),
        InstructionCategory::DataTransfer
    );

    let setne = decode_instruction(&[0x0F, 0x95, 0xC0]);
    assert_eq!(
        categorize_instruction(&setne),
        InstructionCategory::DataTransfer
    );

    let ucomisd = decode_instruction(&[0x66, 0x0F, 0x2E, 0xC0]);
    assert_eq!(
        categorize_instruction(&ucomisd),
        InstructionCategory::CompareTest
    );

    let prefetchnta = decode_instruction(&[0x0F, 0x18, 0x00]);
    assert_eq!(
        categorize_instruction(&prefetchnta),
        InstructionCategory::DataTransfer
    );
}

#[test]
fn symbolizes_known_direct_call_targets() {
    let instruction = decode_instruction(&[0xE8, 0xFB, 0x0F, 0x00, 0x00]);
    let raw_operands = instruction_operands(&instruction);
    let mut function_names = HashMap::new();
    function_names.insert(0x2000, "target_function".to_owned());

    let operands = symbolize_operand_text(&instruction, 0x140000000, raw_operands, &function_names);

    assert_eq!(operands, "target_function");
}

#[test]
fn preserves_unknown_direct_call_targets() {
    let instruction = decode_instruction(&[0xE8, 0xFB, 0x0F, 0x00, 0x00]);
    let raw_operands = instruction_operands(&instruction);

    let operands = symbolize_operand_text(
        &instruction,
        0x140000000,
        raw_operands.clone(),
        &HashMap::new(),
    );

    assert_eq!(operands, raw_operands);
}

#[test]
fn symbolizes_direct_jumps_and_conditional_branches_as_labels() {
    let jmp = decode_instruction(&[0xEB, 0x00]);
    let jne = decode_instruction(&[0x75, 0x00]);

    let jmp_operands = symbolize_operand_text(
        &jmp,
        0x140000000,
        instruction_operands(&jmp),
        &HashMap::new(),
    );
    let jne_operands = symbolize_operand_text(
        &jne,
        0x140000000,
        instruction_operands(&jne),
        &HashMap::new(),
    );

    assert_eq!(jmp_operands, "lbl_140001002");
    assert_eq!(jne_operands, "lbl_140001002");
}

#[test]
fn leaves_indirect_control_flow_operands_unchanged() {
    let indirect_call = decode_instruction(&[0xFF, 0xD0]);
    let indirect_jmp = decode_instruction(&[0xFF, 0xE0]);
    let call_operands = instruction_operands(&indirect_call);
    let jmp_operands = instruction_operands(&indirect_jmp);

    let symbolized_call = symbolize_operand_text(
        &indirect_call,
        0x140000000,
        call_operands.clone(),
        &HashMap::new(),
    );
    let symbolized_jmp = symbolize_operand_text(
        &indirect_jmp,
        0x140000000,
        jmp_operands.clone(),
        &HashMap::new(),
    );

    assert_eq!(symbolized_call, call_operands);
    assert_eq!(symbolized_jmp, jmp_operands);
}
