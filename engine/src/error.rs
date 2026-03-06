use thiserror::Error;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("Invalid JSON-RPC request")]
    InvalidRequest,
    #[error("Method not found")]
    MethodNotFound,
    #[error("Invalid params")]
    InvalidParams(String),
    #[error("I/O error: {0}")]
    Io(String),
    #[error("Unsupported binary format")]
    UnsupportedFormat,
    #[error("Unsupported architecture")]
    UnsupportedArch,
    #[error("Module not found")]
    ModuleNotFound,
    #[error("Module analysis is not ready")]
    AnalysisNotReady,
    #[error("Module analysis failed: {0}")]
    AnalysisFailed(String),
    #[error("Operation canceled")]
    Canceled,
    #[error("Invalid address")]
    InvalidAddress,
    #[error("Engine internal error: {0}")]
    Internal(String),
}

impl EngineError {
    pub(crate) fn code(&self) -> i64 {
        match self {
            Self::InvalidRequest => -32600,
            Self::MethodNotFound => -32601,
            Self::InvalidParams(_) => -32602,
            _ => -32000,
        }
    }

    pub(crate) fn engine_code(&self) -> &'static str {
        match self {
            Self::InvalidRequest => "INVALID_REQUEST",
            Self::MethodNotFound => "METHOD_NOT_FOUND",
            Self::InvalidParams(_) => "INVALID_PARAMS",
            Self::Io(_) => "IO_ERROR",
            Self::UnsupportedFormat => "UNSUPPORTED_FORMAT",
            Self::UnsupportedArch => "UNSUPPORTED_ARCH",
            Self::ModuleNotFound => "MODULE_NOT_FOUND",
            Self::AnalysisNotReady => "ANALYSIS_NOT_READY",
            Self::AnalysisFailed(_) => "ANALYSIS_FAILED",
            Self::Canceled => "CANCELED",
            Self::InvalidAddress => "INVALID_ADDRESS",
            Self::Internal(_) => "ENGINE_INTERNAL",
        }
    }
}
