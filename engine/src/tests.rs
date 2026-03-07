use crate::api::{EnginePingParams, InstructionCategory};
use crate::disasm::{categorize_instruction, parse_hex_u64};
use crate::pe_utils::{
    collect_exception_function_starts_from_entries, collect_tls_callback_starts_from_vas,
    is_valid_exception_function_range,
};
use crate::{EngineError, EngineState};
use goblin::pe::exception::RuntimeFunction;
use iced_x86::{Decoder, DecoderOptions, Instruction};

fn decode_instruction(bytes: &[u8]) -> Instruction {
    let mut decoder = Decoder::with_ip(64, bytes, 0x140001000, DecoderOptions::NONE);
    let mut instruction = Instruction::default();
    decoder.decode_out(&mut instruction);
    instruction
}

#[test]
fn parses_hex_addresses() {
    assert_eq!(parse_hex_u64("0x10").expect("valid"), 16);
    assert!(parse_hex_u64("10").is_err());
}

#[test]
fn ping_returns_engine_version() {
    let mut state = EngineState::default();
    let result = state
        .ping(EnginePingParams::default())
        .expect("ping should succeed");
    assert!(!result.version.is_empty());
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
    assert_eq!(
        categorize_instruction(&call, "callq"),
        InstructionCategory::Call
    );

    let ret = decode_instruction(&[0xC3]);
    assert_eq!(
        categorize_instruction(&ret, "retq"),
        InstructionCategory::Return
    );

    let jmp = decode_instruction(&[0xEB, 0x00]);
    assert_eq!(
        categorize_instruction(&jmp, "jmp"),
        InstructionCategory::ControlFlow
    );
}

#[test]
fn categorizes_system_stack_and_mnemonic_groups() {
    let int3 = decode_instruction(&[0xCC]);
    assert_eq!(
        categorize_instruction(&int3, "int3"),
        InstructionCategory::System
    );

    let push = decode_instruction(&[0x50]);
    assert_eq!(
        categorize_instruction(&push, "push"),
        InstructionCategory::Stack
    );

    let movs = decode_instruction(&[0xA4]);
    assert_eq!(
        categorize_instruction(&movs, "movsb"),
        InstructionCategory::String
    );

    let cmp = decode_instruction(&[0x3B, 0xC0]);
    assert_eq!(
        categorize_instruction(&cmp, "cmp"),
        InstructionCategory::CompareTest
    );

    let add = decode_instruction(&[0x01, 0xD8]);
    assert_eq!(
        categorize_instruction(&add, "addq"),
        InstructionCategory::Arithmetic
    );

    let and = decode_instruction(&[0x21, 0xD8]);
    assert_eq!(
        categorize_instruction(&and, "and"),
        InstructionCategory::Logic
    );

    let shr = decode_instruction(&[0xD1, 0xE8]);
    assert_eq!(
        categorize_instruction(&shr, "shr"),
        InstructionCategory::BitShift
    );

    let mov = decode_instruction(&[0x89, 0xD8]);
    assert_eq!(
        categorize_instruction(&mov, "mov"),
        InstructionCategory::DataTransfer
    );

    let nop = decode_instruction(&[0x90]);
    assert_eq!(
        categorize_instruction(&nop, "nop"),
        InstructionCategory::Other
    );
}
