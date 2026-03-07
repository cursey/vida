use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use engine::api::{
    FunctionGraphByVaParams, FunctionListParams, LinearDisassemblyParams, LinearFindRowByVaParams,
    LinearRowsParams, ModuleAnalysisStatusParams, ModuleOpenParams, ModuleUnloadParams,
};
use engine::{EngineError, EngineState, fixture_path};

fn wait_for_analysis_ready(
    state: &mut EngineState,
    module_id: &str,
) -> engine::api::ModuleAnalysisStatusResult {
    for _ in 0..200 {
        let status = state
            .get_module_analysis_status(ModuleAnalysisStatusParams {
                module_id: module_id.to_owned(),
            })
            .expect("analysis status should load");
        match status.state {
            "ready" => return status,
            "failed" => panic!("Analysis failed: {}", status.message),
            "canceled" => panic!("Analysis unexpectedly canceled"),
            _ => thread::sleep(Duration::from_millis(10)),
        }
    }

    panic!("Timed out waiting for analysis to become ready");
}

#[test]
fn opens_module_lists_functions_and_disassembles() {
    let fixture = fixture_path("minimal_x64.exe");
    assert!(
        fixture.exists(),
        "Fixture does not exist: {}",
        fixture.display()
    );

    let mut state = EngineState::default();
    let open_result = state
        .open_module(ModuleOpenParams {
            path: fixture.to_string_lossy().into_owned(),
        })
        .expect("module should open");

    let module_id = open_result.module_id.clone();
    let entry_va = open_result.entry_va.clone();

    let ready_status = wait_for_analysis_ready(&mut state, &module_id);
    assert_eq!(ready_status.state, "ready");

    let list_result = state
        .list_functions(FunctionListParams {
            module_id: module_id.clone(),
        })
        .expect("function list should load");

    assert!(
        !list_result.functions.is_empty(),
        "Expected at least one seed function"
    );
    assert!(
        list_result
            .functions
            .iter()
            .any(|seed| seed.start == entry_va),
        "Expected at least one function seed at entry VA"
    );

    let starts = list_result
        .functions
        .iter()
        .map(|seed| {
            u64::from_str_radix(seed.start.trim_start_matches("0x"), 16).expect("valid hex VA")
        })
        .collect::<Vec<u64>>();
    let mut sorted_starts = starts.clone();
    sorted_starts.sort_unstable();
    assert_eq!(
        starts, sorted_starts,
        "Function seeds should be sorted by VA"
    );
    sorted_starts.dedup();
    assert_eq!(
        starts.len(),
        sorted_starts.len(),
        "Function seed VAs should be unique"
    );

    for seed in &list_result.functions {
        assert!(
            matches!(seed.kind, "entry" | "export" | "tls" | "exception" | "pdb"),
            "Unexpected function seed kind: {}",
            seed.kind
        );

        if seed.kind == "pdb" {
            assert!(
                !seed.name.is_empty(),
                "PDB function names should not be empty"
            );
        } else if seed.kind == "export" && !seed.name.starts_with("sub_") {
            assert!(
                !seed.name.is_empty(),
                "Named export seeds should preserve a non-empty export name"
            );
        } else {
            let expected_name =
                format!("sub_{}", seed.start.trim_start_matches("0x").to_lowercase());
            assert!(
                seed.name.starts_with("sub_"),
                "Function name should start with sub_: {}",
                seed.name
            );
            assert_eq!(seed.name, expected_name, "Function name should be sub_<va>");
        }
    }

    let disassembly_result = state
        .disassemble_linear(LinearDisassemblyParams {
            module_id: module_id.clone(),
            start: entry_va.clone(),
            max_instructions: Some(64),
        })
        .expect("linear disassembly should succeed");

    assert!(
        !disassembly_result.instructions.is_empty(),
        "Expected non-empty disassembly"
    );
    for instruction in &disassembly_result.instructions {
        let category = format!("{:?}", instruction.instruction_category);
        assert!(
            !category.is_empty(),
            "instructionCategory should not be empty"
        );
    }

    let row_lookup_result = state
        .find_linear_row_by_va(LinearFindRowByVaParams {
            module_id: module_id.clone(),
            va: entry_va.clone(),
        })
        .expect("row lookup should succeed");

    let linear_rows_result = state
        .get_linear_rows(LinearRowsParams {
            module_id: module_id.clone(),
            start_row: row_lookup_result.row_index,
            row_count: 1,
        })
        .expect("linear rows should load");
    let row = linear_rows_result
        .rows
        .first()
        .expect("expected one linear row");

    assert_eq!(
        row.kind, "instruction",
        "entry row should decode to an instruction"
    );
    assert!(
        row.instruction_category.is_some(),
        "instruction rows should include instructionCategory"
    );

    let graph_result = state
        .get_function_graph_by_va(FunctionGraphByVaParams {
            module_id: module_id.clone(),
            va: entry_va.clone(),
        })
        .expect("graph should load");

    assert!(
        !graph_result.blocks.is_empty(),
        "Expected at least one graph block"
    );
    assert!(
        !graph_result.focus_block_id.is_empty(),
        "Graph result should include focusBlockId"
    );

    let first_block = &graph_result.blocks[0];
    assert!(
        first_block.start_va.starts_with("0x"),
        "Graph blocks should include a startVa label"
    );
    let first_instruction = first_block
        .instructions
        .first()
        .expect("graph blocks should include instruction rows");
    assert!(!first_instruction.mnemonic.is_empty());
    assert!(matches!(
        state.get_function_graph_by_va(FunctionGraphByVaParams {
            module_id,
            va: "0x1".to_owned(),
        }),
        Err(EngineError::InvalidAddress)
    ));
}

#[test]
fn discovers_pdb_functions_and_requires_strict_guid_age_match() {
    let fixture_exe = fixture_path("minimal_x64.exe");
    let fixture_pdb = fixture_path("fixture_builder.pdb");
    assert!(
        fixture_exe.exists(),
        "Fixture EXE does not exist: {}",
        fixture_exe.display()
    );
    assert!(
        fixture_pdb.exists(),
        "Fixture PDB does not exist: {}",
        fixture_pdb.display()
    );

    let mut state = EngineState::default();
    let open_result = state
        .open_module(ModuleOpenParams {
            path: fixture_exe.to_string_lossy().into_owned(),
        })
        .expect("module should open");
    let module_id = open_result.module_id;

    let ready_status = wait_for_analysis_ready(&mut state, &module_id);
    assert_eq!(ready_status.state, "ready");

    let list_result = state
        .list_functions(FunctionListParams {
            module_id: module_id.clone(),
        })
        .expect("function list should load");

    let pdb_seeds = list_result
        .functions
        .iter()
        .filter(|seed| seed.kind == "pdb")
        .collect::<Vec<_>>();
    assert!(
        !pdb_seeds.is_empty(),
        "Expected at least one function seed from matching PDB"
    );
    assert!(
        pdb_seeds.iter().any(|seed| !seed.name.starts_with("sub_")),
        "Expected demangled/raw symbol names from PDB seed output"
    );
    assert!(
        pdb_seeds.iter().all(|seed| !seed.name.contains('(')),
        "PDB seed names should be reduced to function names without parameter lists"
    );

    let temp_dir = unique_temp_dir("engine-pdb-mismatch");
    fs::create_dir_all(&temp_dir).expect("failed to create temp directory for mismatch test");
    let mismatch_exe = temp_dir.join("minimal_x64.exe");
    let mismatch_pdb = temp_dir.join("fixture_builder.pdb");
    fs::copy(&fixture_exe, &mismatch_exe).expect("failed to copy fixture exe");
    fs::copy(&fixture_pdb, &mismatch_pdb).expect("failed to copy fixture pdb");
    increment_rsds_age(&mismatch_exe);

    let mut mismatch_state = EngineState::default();
    let mismatch_open = mismatch_state
        .open_module(ModuleOpenParams {
            path: mismatch_exe.to_string_lossy().into_owned(),
        })
        .expect("mismatch module should open");
    let mismatch_list = mismatch_state
        .list_functions(FunctionListParams {
            module_id: mismatch_open.module_id,
        })
        .expect("mismatch function list should load");

    assert!(
        mismatch_list
            .functions
            .iter()
            .all(|seed| seed.kind != "pdb"),
        "Strict GUID+age mismatch should reject PDB symbols"
    );

    let _ = fs::remove_dir_all(temp_dir);
}

#[test]
fn unload_removes_module_from_engine_state() {
    let fixture = fixture_path("minimal_x64.exe");
    let mut state = EngineState::default();

    let open_result = state
        .open_module(ModuleOpenParams {
            path: fixture.to_string_lossy().into_owned(),
        })
        .expect("module should open");
    let module_id = open_result.module_id;

    state
        .unload_module(ModuleUnloadParams {
            module_id: module_id.clone(),
        })
        .expect("module should unload");

    assert!(matches!(
        state.get_module_analysis_status(ModuleAnalysisStatusParams { module_id }),
        Err(EngineError::ModuleNotFound)
    ));
}

fn unique_temp_dir(prefix: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time should be monotonic")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{stamp}"))
}

fn increment_rsds_age(path: &Path) {
    let mut bytes = fs::read(path).expect("failed to read fixture copy for RSDS mutation");
    let marker_index = bytes
        .windows(4)
        .position(|window| window == b"RSDS")
        .expect("fixture should contain an RSDS record");
    let age_offset = marker_index + 20;

    let age_bytes = bytes
        .get(age_offset..age_offset + 4)
        .expect("RSDS age bytes should be in range");
    let age = u32::from_le_bytes(
        age_bytes
            .try_into()
            .expect("age bytes should always be exactly 4 bytes"),
    );
    let updated_age = age.wrapping_add(1);
    bytes[age_offset..age_offset + 4].copy_from_slice(&updated_age.to_le_bytes());

    fs::write(path, bytes).expect("failed to write mutated RSDS age");
}
