use std::fs;

use engine::{EngineState, RpcRequest, RpcResponse};
use jsonschema::validator_for;
use serde_json::{Value, json};

fn load_protocol_schema() -> Value {
    let schema_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("shared")
        .join("schemas")
        .join("protocol.schema.json");

    let schema_text = fs::read_to_string(&schema_path).unwrap_or_else(|error| {
        panic!(
            "failed to read schema at {}: {error}",
            schema_path.display()
        )
    });

    serde_json::from_str(&schema_text).expect("schema JSON should be valid")
}

#[test]
fn request_examples_validate_against_schema() {
    let schema = load_protocol_schema();
    let validator = validator_for(&schema).expect("schema should compile");

    let requests = vec![
        json!({ "jsonrpc": "2.0", "id": 1, "method": "engine.ping", "params": {} }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "module.open", "params": { "path": "C:\\tmp\\a.exe" } }),
        json!({ "jsonrpc": "2.0", "id": 3, "method": "module.info", "params": { "moduleId": "m1" } }),
        json!({ "jsonrpc": "2.0", "id": 4, "method": "function.list", "params": { "moduleId": "m1" } }),
        json!({ "jsonrpc": "2.0", "id": 5, "method": "function.getGraphByVa", "params": { "moduleId": "m1", "va": "0x140001000" } }),
        json!({
            "jsonrpc": "2.0",
            "id": 6,
            "method": "function.disassembleLinear",
            "params": { "moduleId": "m1", "start": "0x1000", "maxInstructions": 64 }
        }),
    ];

    for request in requests {
        validator
            .validate(&request)
            .unwrap_or_else(|error| panic!("request failed schema validation: {error}"));
    }
}

#[test]
fn ping_response_validates_against_schema() {
    let schema = load_protocol_schema();
    let validator = validator_for(&schema).expect("schema should compile");
    let mut state = EngineState::default();

    let response = state.handle_request(RpcRequest {
        jsonrpc: "2.0".to_owned(),
        id: json!(100),
        method: "engine.ping".to_owned(),
        params: json!({}),
    });

    let response_value = match response {
        RpcResponse::Success { result, id, .. } => {
            json!({ "jsonrpc": "2.0", "id": id, "result": result })
        }
        RpcResponse::Error { error, id, .. } => {
            json!({ "jsonrpc": "2.0", "id": id, "error": error })
        }
    };

    validator
        .validate(&response_value)
        .unwrap_or_else(|error| panic!("response failed schema validation: {error}"));
}

#[test]
fn function_list_response_with_extended_kinds_validates_against_schema() {
    let schema = load_protocol_schema();
    let validator = validator_for(&schema).expect("schema should compile");

    let response_value = json!({
        "jsonrpc": "2.0",
        "id": 101,
        "result": {
            "functions": [
                { "start": "0x1000", "name": "entry", "kind": "entry" },
                { "start": "0x2000", "name": "exported", "kind": "export" },
                { "start": "0x2800", "name": "tls_callback", "kind": "tls" },
                { "start": "0x3000", "name": "exception_0x3000", "kind": "exception" },
                { "start": "0x4000", "name": "module::main", "kind": "pdb" }
            ]
        }
    });

    validator
        .validate(&response_value)
        .unwrap_or_else(|error| panic!("response failed schema validation: {error}"));
}

#[test]
fn disassembly_response_with_instruction_category_validates_against_schema() {
    let schema = load_protocol_schema();
    let validator = validator_for(&schema).expect("schema should compile");

    let response_value = json!({
        "jsonrpc": "2.0",
        "id": 102,
        "result": {
            "instructions": [
                {
                    "address": "0x1000",
                    "bytes": "55",
                    "mnemonic": "push",
                    "operands": "rbp",
                    "instructionCategory": "stack"
                }
            ],
            "stopReason": "ret"
        }
    });

    validator
        .validate(&response_value)
        .unwrap_or_else(|error| panic!("response failed schema validation: {error}"));
}

#[test]
fn graph_response_with_instruction_category_validates_against_schema() {
    let schema = load_protocol_schema();
    let validator = validator_for(&schema).expect("schema should compile");

    let response_value = json!({
        "jsonrpc": "2.0",
        "id": 103,
        "result": {
            "functionStartVa": "0x140001000",
            "functionName": "sub_140001000",
            "focusBlockId": "b_1000",
            "blocks": [
                {
                    "id": "b_1000",
                    "startVa": "0x140001000",
                    "instructions": [
                        {
                            "mnemonic": "push",
                            "operands": "rbp",
                            "instructionCategory": "stack"
                        }
                    ]
                }
            ],
            "edges": []
        }
    });

    validator
        .validate(&response_value)
        .unwrap_or_else(|error| panic!("response failed schema validation: {error}"));
}
