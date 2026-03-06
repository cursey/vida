use std::io::{self, BufRead, Write};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::EngineError;
use crate::state::EngineState;

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub jsonrpc: String,
    pub id: Value,
    pub method: String,
    pub params: Value,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum RpcResponse {
    Success {
        jsonrpc: &'static str,
        id: Value,
        result: Value,
    },
    Error {
        jsonrpc: &'static str,
        id: Value,
        error: RpcError,
    },
}

#[derive(Debug, Serialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<RpcErrorData>,
}

#[derive(Debug, Serialize)]
pub struct RpcErrorData {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

pub(crate) fn is_valid_request_id(value: &Value) -> bool {
    value.is_string() || value.is_u64() || value.is_i64()
}

pub(crate) fn rpc_error(id: Value, error: EngineError, details: Option<Value>) -> RpcResponse {
    RpcResponse::Error {
        jsonrpc: "2.0",
        id,
        error: RpcError {
            code: error.code(),
            message: error.to_string(),
            data: Some(RpcErrorData {
                code: error.engine_code().to_owned(),
                details,
            }),
        },
    }
}

pub fn run_stdio_server() -> Result<(), EngineError> {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    let mut state = EngineState::default();

    for line in stdin.lock().lines() {
        let line = line.map_err(|error| EngineError::Io(error.to_string()))?;
        if line.trim().is_empty() {
            continue;
        }

        let parsed_request = match serde_json::from_str::<RpcRequest>(&line) {
            Ok(request) => request,
            Err(_) => {
                let response = rpc_error(Value::Null, EngineError::InvalidRequest, None);
                let encoded = serde_json::to_string(&response)
                    .map_err(|error| EngineError::Internal(error.to_string()))?;
                writeln!(stdout, "{encoded}")
                    .map_err(|error| EngineError::Io(error.to_string()))?;
                stdout
                    .flush()
                    .map_err(|error| EngineError::Io(error.to_string()))?;
                continue;
            }
        };

        let response = state.handle_request(parsed_request);
        let encoded = serde_json::to_string(&response)
            .map_err(|error| EngineError::Internal(error.to_string()))?;
        writeln!(stdout, "{encoded}").map_err(|error| EngineError::Io(error.to_string()))?;
        stdout
            .flush()
            .map_err(|error| EngineError::Io(error.to_string()))?;
    }

    Ok(())
}
