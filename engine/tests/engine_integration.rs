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
    let entry_rva = open_result
        .get("entryRva")
        .and_then(Value::as_str)
        .expect("entryRva should be string")
        .to_owned();

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
            .any(|seed| { seed.get("kind").and_then(Value::as_str) == Some("entry") }),
        "Expected entry seed to be present"
    );

    let starts = functions
        .iter()
        .map(|seed| {
            let raw = seed
                .get("start")
                .and_then(Value::as_str)
                .expect("function start should be string");
            u64::from_str_radix(raw.trim_start_matches("0x"), 16).expect("valid hex RVA")
        })
        .collect::<Vec<u64>>();
    let mut sorted_starts = starts.clone();
    sorted_starts.sort_unstable();
    assert_eq!(
        starts, sorted_starts,
        "Function seeds should be sorted by RVA"
    );
    sorted_starts.dedup();
    assert_eq!(
        starts.len(),
        sorted_starts.len(),
        "Function seed RVAs should be unique",
    );

    for seed in functions {
        let kind = seed
            .get("kind")
            .and_then(Value::as_str)
            .expect("function kind should be string");
        assert!(
            matches!(kind, "entry" | "export" | "exception"),
            "Unexpected function seed kind: {kind}"
        );

        let name = seed
            .get("name")
            .and_then(Value::as_str)
            .expect("function name should be string");
        assert!(
            name.starts_with("sub_"),
            "Function name should start with sub_: {name}"
        );
        assert_eq!(
            name.len(),
            12,
            "Function name should be sub_ plus 8 hex chars: {name}"
        );
        assert!(
            name[4..]
                .chars()
                .all(|value| value.is_ascii_digit() || ('a'..='f').contains(&value)),
            "Function name suffix should be lowercase hex: {name}"
        );
    }

    let start = list_result
        .get("functions")
        .and_then(Value::as_array)
        .expect("functions array should exist")[0]
        .get("start")
        .and_then(Value::as_str)
        .expect("function start should be string")
        .to_owned();

    let disassembly_result = success_result(state.handle_request(RpcRequest {
        jsonrpc: "2.0".to_owned(),
        id: json!(3),
        method: "function.disassembleLinear".to_owned(),
        params: json!({
            "moduleId": module_id,
            "start": start,
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
        method: "linear.findRowByRva".to_owned(),
        params: json!({
            "moduleId": module_id,
            "rva": entry_rva
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
}
