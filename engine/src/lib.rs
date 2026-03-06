mod cfg;
mod disasm;
mod error;
mod linear;
mod pdb_symbols;
mod pe_utils;
mod protocol;
mod rpc;
mod state;

pub use error::EngineError;
pub use rpc::{RpcError, RpcErrorData, RpcRequest, RpcResponse, run_stdio_server};
pub use state::EngineState;

use std::path::{Path, PathBuf};

pub fn fixture_path(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name)
}

#[cfg(test)]
mod tests;
