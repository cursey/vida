use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use engine::{EngineState, RpcRequest, RpcResponse, fixture_path};
use serde_json::{Value, json};

fn success_result(response: RpcResponse) -> Value {
    match response {
        RpcResponse::Success { result, .. } => result,
        RpcResponse::Error { error, .. } => {
            panic!("Expected success, got error: {}", error.message)
        }
    }
}

fn error_engine_code(response: RpcResponse) -> String {
    match response {
        RpcResponse::Error { error, .. } => error
            .data
            .map(|value| value.code)
            .unwrap_or_else(|| "<missing>".to_owned()),
        RpcResponse::Success { .. } => panic!("Expected error, got success"),
    }
}

fn wait_for_analysis_ready(state: &mut EngineState, module_id: &str) -> Value {
    for _ in 0..200 {
        let status = success_result(state.handle_request(RpcRequest {
            jsonrpc: "2.0".to_owned(),
            id: json!(9_000),
            method: "module.getAnalysisStatus".to_owned(),
            params: json!({ "moduleId": module_id }),
        }));
        let state_name = status
            .get("state")
            .and_then(Value::as_str)
            .expect("analysis status should include state");
        match state_name {
            "ready" => return status,
            "failed" => panic!(
                "Analysis failed: {}",
                status
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("<missing message>")
            ),
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

    let open_result = success_result(state.handle_request(RpcRequest {
        jsonrpc: "2.0".to_owned(),
        id: json!(1),
        method: "module.open".to_owned(),
        params: json!({ "path": fixture.to_string_lossy() }),
    }));

    let module_id = open_result
        .get("moduleId")
        .and_then(Value::as_str)
        .expect("moduleId should be string")
        .to_owned();
    let entry_va = open_result
        .get("entryVa")
        .and_then(Value::as_str)
        .expect("entryVa should be string")
        .to_owned();

    let ready_status = wait_for_analysis_ready(&mut state, &module_id);
    assert_eq!(
        ready_status.get("state").and_then(Value::as_str),
        Some("ready")
    );

    let list_result = success_result(state.handle_request(RpcRequest {
        jsonrpc: "2.0".to_owned(),
        id: json!(2),
        method: "function.list".to_owned(),
        params: json!({ "moduleId": module_id }),
    }));

    let functions = list_result
        .get("functions")
        .and_then(Value::as_array)
        .expect("functions array should exist");

    assert!(!functions.is_empty(), "Expected at least one seed function");
    assert!(
        functions
            .iter()
            .any(|seed| seed.get("start").and_then(Value::as_str) == Some(entry_va.as_str())),
        "Expected at least one function seed at entry VA"
    );

    let starts = functions
        .iter()
        .map(|seed| {
            let raw = seed
                .get("start")
                .and_then(Value::as_str)
                .expect("function start should be string");
            u64::from_str_radix(raw.trim_start_matches("0x"), 16).expect("valid hex VA")
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
        "Function seed VAs should be unique",
    );

    for seed in functions {
        let kind = seed
            .get("kind")
            .and_then(Value::as_str)
            .expect("function kind should be string");
        assert!(
            matches!(kind, "entry" | "export" | "tls" | "exception" | "pdb"),
            "Unexpected function seed kind: {kind}"
        );

        let name = seed
            .get("name")
            .and_then(Value::as_str)
            .expect("function name should be string");
        if kind == "pdb" {
            assert!(!name.is_empty(), "PDB function names should not be empty");
        } else if kind == "export" && !name.starts_with("sub_") {
            assert!(
                !name.is_empty(),
                "Named export seeds should preserve a non-empty export name"
            );
        } else {
            let start = seed
                .get("start")
                .and_then(Value::as_str)
                .expect("function start should be string");
            let expected_name = format!("sub_{}", start.trim_start_matches("0x").to_lowercase());
            assert!(
                name.starts_with("sub_"),
                "Function name should start with sub_: {name}"
            );
            assert_eq!(
                name, expected_name,
                "Function name should be sub_<va>: {name}"
            );
        }
    }

    let disassembly_result = success_result(state.handle_request(RpcRequest {
        jsonrpc: "2.0".to_owned(),
        id: json!(3),
        method: "function.disassembleLinear".to_owned(),
        params: json!({
            "moduleId": module_id,
            "start": entry_va,
            "maxInstructions": 64
        }),
    }));

    let instructions = disassembly_result
        .get("instructions")
        .and_then(Value::as_array)
        .expect("instructions array should exist");

    assert!(!instructions.is_empty(), "Expected non-empty disassembly");
    for instruction in instructions {
        let category = instruction
            .get("instructionCategory")
            .and_then(Value::as_str)
            .expect("instructionCategory should be a string");
        assert!(
            !category.is_empty(),
            "instructionCategory should not be empty"
        );
    }

    let row_lookup_result = success_result(state.handle_request(RpcRequest {
        jsonrpc: "2.0".to_owned(),
        id: json!(4),
        method: "linear.findRowByVa".to_owned(),
        params: json!({
            "moduleId": module_id,
            "va": entry_va
        }),
    }));
    let row_index = row_lookup_result
        .get("rowIndex")
        .and_then(Value::as_u64)
        .expect("rowIndex should be integer");

    let linear_rows_result = success_result(state.handle_request(RpcRequest {
        jsonrpc: "2.0".to_owned(),
        id: json!(5),
        method: "linear.getRows".to_owned(),
        params: json!({
            "moduleId": module_id,
            "startRow": row_index,
            "rowCount": 1
        }),
    }));
    let row = linear_rows_result
        .get("rows")
        .and_then(Value::as_array)
        .and_then(|rows| rows.first())
        .expect("expected one linear row");

    assert_eq!(
        row.get("kind").and_then(Value::as_str),
        Some("instruction"),
        "entry row should decode to an instruction"
    );
    assert!(
        row.get("instructionCategory")
            .and_then(Value::as_str)
            .is_some(),
        "instruction rows should include instructionCategory"
    );

    let graph_result = success_result(state.handle_request(RpcRequest {
        jsonrpc: "2.0".to_owned(),
        id: json!(6),
        method: "function.getGraphByVa".to_owned(),
        params: json!({
            "moduleId": module_id,
            "va": entry_va
        }),
    }));

    let blocks = graph_result
        .get("blocks")
        .and_then(Value::as_array)
        .expect("graph blocks should be present");
    assert!(!blocks.is_empty(), "Expected at least one graph block");
    assert!(
        graph_result
            .get("focusBlockId")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty()),
        "Graph result should include focusBlockId"
    );

    let first_block = &blocks[0];
    assert!(
        first_block
            .get("startVa")
            .and_then(Value::as_str)
            .is_some_and(|value| value.starts_with("0x")),
        "Graph blocks should include a startVa label",
    );
    let first_instruction = first_block
        .get("instructions")
        .and_then(Value::as_array)
        .and_then(|value| value.first())
        .expect("graph blocks should include instruction rows");
    assert!(
        first_instruction
            .get("mnemonic")
            .and_then(Value::as_str)
            .is_some(),
        "Graph instruction rows should include mnemonic",
    );
    assert!(
        first_instruction
            .get("operands")
            .and_then(Value::as_str)
            .is_some(),
        "Graph instruction rows should include operands",
    );
    assert!(
        first_instruction
            .get("instructionCategory")
            .and_then(Value::as_str)
            .is_some(),
        "Graph instruction rows should include instructionCategory",
    );
    assert!(
        first_instruction.get("address").is_none()
            && first_instruction.get("comment").is_none()
            && first_instruction.get("section").is_none(),
        "Graph instruction rows should not include disassembly-only fields",
    );

    let invalid_graph_error_code = error_engine_code(state.handle_request(RpcRequest {
        jsonrpc: "2.0".to_owned(),
        id: json!(7),
        method: "function.getGraphByVa".to_owned(),
        params: json!({
            "moduleId": module_id,
            "va": "0x1"
        }),
    }));
    assert_eq!(invalid_graph_error_code, "INVALID_ADDRESS");
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
    let open_result = success_result(state.handle_request(RpcRequest {
        jsonrpc: "2.0".to_owned(),
        id: json!(100),
        method: "module.open".to_owned(),
        params: json!({ "path": fixture_exe.to_string_lossy() }),
    }));
    let module_id = open_result
        .get("moduleId")
        .and_then(Value::as_str)
        .expect("moduleId should be string")
        .to_owned();

    let ready_status = wait_for_analysis_ready(&mut state, &module_id);
    assert_eq!(
        ready_status.get("state").and_then(Value::as_str),
        Some("ready")
    );

    let list_result = success_result(state.handle_request(RpcRequest {
        jsonrpc: "2.0".to_owned(),
        id: json!(101),
        method: "function.list".to_owned(),
        params: json!({ "moduleId": module_id }),
    }));
    let functions = list_result
        .get("functions")
        .and_then(Value::as_array)
        .expect("functions array should exist");

    let pdb_seeds = functions
        .iter()
        .filter(|seed| seed.get("kind").and_then(Value::as_str) == Some("pdb"))
        .collect::<Vec<_>>();
    assert!(
        !pdb_seeds.is_empty(),
        "Expected at least one function seed from matching PDB"
    );
    assert!(
        pdb_seeds.iter().any(|seed| {
            seed.get("name")
                .and_then(Value::as_str)
                .is_some_and(|name| !name.starts_with("sub_"))
        }),
        "Expected demangled/raw symbol names from PDB seed output"
    );

    let temp_dir = unique_temp_dir("engine-pdb-mismatch");
    fs::create_dir_all(&temp_dir).expect("failed to create temp directory for mismatch test");
    let mismatch_exe = temp_dir.join("minimal_x64.exe");
    let mismatch_pdb = temp_dir.join("fixture_builder.pdb");
    fs::copy(&fixture_exe, &mismatch_exe).expect("failed to copy fixture exe");
    fs::copy(&fixture_pdb, &mismatch_pdb).expect("failed to copy fixture pdb");
    increment_rsds_age(&mismatch_exe);

    let mut mismatch_state = EngineState::default();
    let mismatch_open = success_result(mismatch_state.handle_request(RpcRequest {
        jsonrpc: "2.0".to_owned(),
        id: json!(102),
        method: "module.open".to_owned(),
        params: json!({ "path": mismatch_exe.to_string_lossy() }),
    }));
    let mismatch_module_id = mismatch_open
        .get("moduleId")
        .and_then(Value::as_str)
        .expect("moduleId should be string")
        .to_owned();
    let mismatch_list = success_result(mismatch_state.handle_request(RpcRequest {
        jsonrpc: "2.0".to_owned(),
        id: json!(103),
        method: "function.list".to_owned(),
        params: json!({ "moduleId": mismatch_module_id }),
    }));
    let mismatch_functions = mismatch_list
        .get("functions")
        .and_then(Value::as_array)
        .expect("functions array should exist");

    assert!(
        mismatch_functions
            .iter()
            .all(|seed| seed.get("kind").and_then(Value::as_str) != Some("pdb")),
        "Strict GUID+age mismatch should reject PDB symbols"
    );

    let _ = fs::remove_dir_all(temp_dir);
}

#[test]
fn unload_removes_module_from_engine_state() {
    let fixture = fixture_path("minimal_x64.exe");
    let mut state = EngineState::default();

    let open_result = success_result(state.handle_request(RpcRequest {
        jsonrpc: "2.0".to_owned(),
        id: json!(200),
        method: "module.open".to_owned(),
        params: json!({ "path": fixture.to_string_lossy() }),
    }));
    let module_id = open_result
        .get("moduleId")
        .and_then(Value::as_str)
        .expect("moduleId should be string")
        .to_owned();

    success_result(state.handle_request(RpcRequest {
        jsonrpc: "2.0".to_owned(),
        id: json!(201),
        method: "module.unload".to_owned(),
        params: json!({ "moduleId": module_id }),
    }));

    let status_error = error_engine_code(state.handle_request(RpcRequest {
        jsonrpc: "2.0".to_owned(),
        id: json!(202),
        method: "module.getAnalysisStatus".to_owned(),
        params: json!({ "moduleId": module_id }),
    }));
    assert_eq!(status_error, "MODULE_NOT_FOUND");
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
