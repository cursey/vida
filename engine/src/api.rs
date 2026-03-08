use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleOpenParams {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleUnloadParams {
    #[serde(rename = "moduleId")]
    pub module_id: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ModuleUnloadResult {}

#[derive(Debug, Clone, Serialize)]
pub struct ModuleOpenResult {
    #[serde(rename = "moduleId")]
    pub module_id: String,
    pub arch: &'static str,
    #[serde(rename = "imageBase")]
    pub image_base: String,
    #[serde(rename = "entryVa")]
    pub entry_va: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleAnalysisStatusParams {
    #[serde(rename = "moduleId")]
    pub module_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModuleAnalysisStatusResult {
    pub state: &'static str,
    pub message: String,
    #[serde(rename = "discoveredFunctionCount")]
    pub discovered_function_count: usize,
    #[serde(rename = "totalFunctionCount", skip_serializing_if = "Option::is_none")]
    pub total_function_count: Option<usize>,
    #[serde(
        rename = "analyzedFunctionCount",
        skip_serializing_if = "Option::is_none"
    )]
    pub analyzed_function_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleInfoParams {
    #[serde(rename = "moduleId")]
    pub module_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModuleInfoResult {
    pub sections: Vec<SectionInfo>,
    pub imports: Vec<ImportInfo>,
    pub exports: Vec<ExportInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleMemoryOverviewParams {
    #[serde(rename = "moduleId")]
    pub module_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModuleMemoryOverviewResult {
    #[serde(rename = "startVa")]
    pub start_va: String,
    #[serde(rename = "endVa")]
    pub end_va: String,
    pub slices: Vec<MemoryOverviewSliceKind>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryOverviewSliceKind {
    Unmapped,
    Ro,
    Rw,
    Rwx,
    Explored,
    Unexplored,
}

#[derive(Debug, Clone, Serialize)]
pub struct SectionInfo {
    pub name: String,
    #[serde(rename = "startVa")]
    pub start_va: String,
    #[serde(rename = "endVa")]
    pub end_va: String,
    #[serde(rename = "rawOffset")]
    pub raw_offset: usize,
    #[serde(rename = "rawSize")]
    pub raw_size: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportInfo {
    pub library: String,
    pub name: String,
    #[serde(rename = "addressVa")]
    pub address_va: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExportInfo {
    pub name: String,
    pub start: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionListParams {
    #[serde(rename = "moduleId")]
    pub module_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FunctionSeed {
    pub start: String,
    pub name: String,
    pub kind: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct FunctionListResult {
    pub functions: Vec<FunctionSeed>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionGraphByVaParams {
    #[serde(rename = "moduleId")]
    pub module_id: String,
    pub va: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FunctionGraphInstruction {
    pub mnemonic: String,
    pub operands: String,
    #[serde(rename = "instructionCategory")]
    pub instruction_category: InstructionCategory,
}

#[derive(Debug, Clone, Serialize)]
pub struct FunctionGraphBlock {
    pub id: String,
    #[serde(rename = "startVa")]
    pub start_va: String,
    pub instructions: Vec<FunctionGraphInstruction>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FunctionGraphEdge {
    #[serde(rename = "fromBlockId")]
    pub from_block_id: String,
    #[serde(rename = "toBlockId")]
    pub to_block_id: String,
    pub kind: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct FunctionGraphByVaResult {
    #[serde(rename = "functionStartVa")]
    pub function_start_va: String,
    #[serde(rename = "functionName")]
    pub function_name: String,
    #[serde(rename = "focusBlockId")]
    pub focus_block_id: String,
    pub blocks: Vec<FunctionGraphBlock>,
    pub edges: Vec<FunctionGraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XrefsToVaParams {
    #[serde(rename = "moduleId")]
    pub module_id: String,
    pub va: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum XrefKind {
    Call,
    Jump,
    Branch,
    Data,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum XrefTargetKind {
    Code,
    Data,
}

#[derive(Debug, Clone, Serialize)]
pub struct XrefRecord {
    #[serde(rename = "sourceVa")]
    pub source_va: String,
    #[serde(rename = "sourceFunctionStartVa")]
    pub source_function_start_va: String,
    #[serde(rename = "sourceFunctionName")]
    pub source_function_name: String,
    pub kind: XrefKind,
    #[serde(rename = "targetVa")]
    pub target_va: String,
    #[serde(rename = "targetKind")]
    pub target_kind: XrefTargetKind,
}

#[derive(Debug, Clone, Serialize)]
pub struct XrefsToVaResult {
    #[serde(rename = "targetVa")]
    pub target_va: String,
    pub xrefs: Vec<XrefRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearDisassemblyParams {
    #[serde(rename = "moduleId")]
    pub module_id: String,
    pub start: String,
    #[serde(rename = "maxInstructions")]
    pub max_instructions: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearViewInfoParams {
    #[serde(rename = "moduleId")]
    pub module_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinearViewInfoResult {
    #[serde(rename = "rowCount")]
    pub row_count: u64,
    #[serde(rename = "minVa")]
    pub min_va: String,
    #[serde(rename = "maxVa")]
    pub max_va: String,
    #[serde(rename = "rowHeight")]
    pub row_height: u64,
    #[serde(rename = "dataGroupSize")]
    pub data_group_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearRowsParams {
    #[serde(rename = "moduleId")]
    pub module_id: String,
    #[serde(rename = "startRow")]
    pub start_row: u64,
    #[serde(rename = "rowCount")]
    pub row_count: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinearRowsResult {
    pub rows: Vec<LinearViewRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearFindRowByVaParams {
    #[serde(rename = "moduleId")]
    pub module_id: String,
    pub va: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinearFindRowByVaResult {
    #[serde(rename = "rowIndex")]
    pub row_index: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinearDisassemblyResult {
    pub instructions: Vec<InstructionRow>,
    #[serde(rename = "stopReason")]
    pub stop_reason: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstructionCategory {
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

#[derive(Debug, Clone, Serialize)]
pub struct InstructionRow {
    pub address: String,
    pub bytes: String,
    pub mnemonic: String,
    pub operands: String,
    #[serde(rename = "instructionCategory")]
    pub instruction_category: InstructionCategory,
    #[serde(skip_serializing_if = "Option::is_none", rename = "branchTarget")]
    pub branch_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "callTarget")]
    pub call_target: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinearViewRow {
    pub kind: &'static str,
    pub address: String,
    pub bytes: String,
    pub mnemonic: String,
    pub operands: String,
    #[serde(
        skip_serializing_if = "Option::is_none",
        rename = "instructionCategory"
    )]
    pub instruction_category: Option<InstructionCategory>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "branchTarget")]
    pub branch_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "callTarget")]
    pub call_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}
