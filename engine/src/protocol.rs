use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub(crate) struct EnginePingParams {}

#[derive(Debug, Serialize)]
pub(crate) struct EnginePingResult {
    pub(crate) version: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ModuleOpenParams {
    pub(crate) path: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ModuleOpenResult {
    #[serde(rename = "moduleId")]
    pub(crate) module_id: String,
    pub(crate) arch: &'static str,
    #[serde(rename = "imageBase")]
    pub(crate) image_base: String,
    #[serde(rename = "entryRva")]
    pub(crate) entry_rva: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct ModuleInfoParams {
    #[serde(rename = "moduleId")]
    pub(crate) module_id: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ModuleInfoResult {
    pub(crate) sections: Vec<SectionInfo>,
    pub(crate) imports: Vec<ImportInfo>,
    pub(crate) exports: Vec<ExportInfo>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SectionInfo {
    pub(crate) name: String,
    #[serde(rename = "startRva")]
    pub(crate) start_rva: String,
    #[serde(rename = "endRva")]
    pub(crate) end_rva: String,
    #[serde(rename = "rawOffset")]
    pub(crate) raw_offset: usize,
    #[serde(rename = "rawSize")]
    pub(crate) raw_size: usize,
}

#[derive(Debug, Serialize)]
pub(crate) struct ImportInfo {
    pub(crate) library: String,
    pub(crate) name: String,
    #[serde(rename = "addressRva")]
    pub(crate) address_rva: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct ExportInfo {
    pub(crate) name: String,
    pub(crate) start: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct FunctionListParams {
    #[serde(rename = "moduleId")]
    pub(crate) module_id: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct FunctionSeed {
    pub(crate) start: String,
    pub(crate) name: String,
    pub(crate) kind: &'static str,
}

#[derive(Debug, Serialize)]
pub(crate) struct FunctionListResult {
    pub(crate) functions: Vec<FunctionSeed>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct LinearDisassemblyParams {
    #[serde(rename = "moduleId")]
    pub(crate) module_id: String,
    pub(crate) start: String,
    #[serde(rename = "maxInstructions")]
    pub(crate) max_instructions: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct LinearViewInfoParams {
    #[serde(rename = "moduleId")]
    pub(crate) module_id: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct LinearViewInfoResult {
    #[serde(rename = "rowCount")]
    pub(crate) row_count: u64,
    #[serde(rename = "minRva")]
    pub(crate) min_rva: String,
    #[serde(rename = "maxRva")]
    pub(crate) max_rva: String,
    #[serde(rename = "rowHeight")]
    pub(crate) row_height: u64,
    #[serde(rename = "dataGroupSize")]
    pub(crate) data_group_size: u64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct LinearRowsParams {
    #[serde(rename = "moduleId")]
    pub(crate) module_id: String,
    #[serde(rename = "startRow")]
    pub(crate) start_row: u64,
    #[serde(rename = "rowCount")]
    pub(crate) row_count: u64,
}

#[derive(Debug, Serialize)]
pub(crate) struct LinearRowsResult {
    pub(crate) rows: Vec<LinearViewRow>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct LinearFindRowByRvaParams {
    #[serde(rename = "moduleId")]
    pub(crate) module_id: String,
    pub(crate) rva: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct LinearFindRowByRvaResult {
    #[serde(rename = "rowIndex")]
    pub(crate) row_index: u64,
}

#[derive(Debug, Serialize)]
pub(crate) struct LinearDisassemblyResult {
    pub(crate) instructions: Vec<InstructionRow>,
    #[serde(rename = "stopReason")]
    pub(crate) stop_reason: &'static str,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum InstructionCategory {
    Call,
    Return,
    ControlFlow,
    System,
    Stack,
    String,
    CompareTest,
    Arithmetic,
    Logic,
    BitShift,
    DataTransfer,
    Other,
}

#[derive(Debug, Serialize)]
pub(crate) struct InstructionRow {
    pub(crate) address: String,
    pub(crate) bytes: String,
    pub(crate) mnemonic: String,
    pub(crate) operands: String,
    #[serde(rename = "instructionCategory")]
    pub(crate) instruction_category: InstructionCategory,
    #[serde(skip_serializing_if = "Option::is_none", rename = "branchTarget")]
    pub(crate) branch_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "callTarget")]
    pub(crate) call_target: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct LinearViewRow {
    pub(crate) kind: &'static str,
    pub(crate) address: String,
    pub(crate) bytes: String,
    pub(crate) mnemonic: String,
    pub(crate) operands: String,
    #[serde(
        skip_serializing_if = "Option::is_none",
        rename = "instructionCategory"
    )]
    pub(crate) instruction_category: Option<InstructionCategory>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "branchTarget")]
    pub(crate) branch_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "callTarget")]
    pub(crate) call_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) comment: Option<String>,
}
