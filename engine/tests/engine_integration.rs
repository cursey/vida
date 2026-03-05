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

    let start = functions[0]
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
}
