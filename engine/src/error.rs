use thiserror::Error;

#[derive(Debug, Error)]
pub enum EngineError {
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
