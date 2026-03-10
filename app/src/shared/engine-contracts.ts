export type HexAddress = string;

export type ModuleOpenParams = {
  path: string;
  pdbPath?: string;
};

export type ModulePdbStatusParams = {
  path: string;
};

export type ModuleInfoParams = {
  moduleId: string;
};

export type FunctionListParams = {
  moduleId: string;
};

export type FunctionGraphByVaParams = {
  moduleId: string;
  va: HexAddress;
};

export type XrefsToVaParams = {
  moduleId: string;
  va: HexAddress;
};

export type LinearDisassemblyParams = {
  moduleId: string;
  start: HexAddress;
  maxInstructions?: number;
};

export type EngineMethod =
  | "module.open"
  | "module.getPdbStatus"
  | "module.unload"
  | "module.getAnalysisStatus"
  | "module.info"
  | "module.getMemoryOverview"
  | "function.list"
  | "function.getGraphByVa"
  | "xref.getXrefsToVa"
  | "function.disassembleLinear"
  | "linear.getViewInfo"
  | "linear.getRows"
  | "linear.findRowByVa";

export type MethodParams = {
  "module.open": ModuleOpenParams;
  "module.getPdbStatus": ModulePdbStatusParams;
  "module.unload": {
    moduleId: string;
  };
  "module.getAnalysisStatus": {
    moduleId: string;
  };
  "module.info": ModuleInfoParams;
  "module.getMemoryOverview": {
    moduleId: string;
  };
  "function.list": FunctionListParams;
  "function.getGraphByVa": FunctionGraphByVaParams;
  "xref.getXrefsToVa": XrefsToVaParams;
  "function.disassembleLinear": LinearDisassemblyParams;
  "linear.getViewInfo": {
    moduleId: string;
  };
  "linear.getRows": {
    moduleId: string;
    startRow: number;
    rowCount: number;
  };
  "linear.findRowByVa": {
    moduleId: string;
    va: HexAddress;
  };
};

export type StopReason =
  | "ret"
  | "left_section"
  | "invalid_instruction_streak"
  | "max_instructions"
  | "end_of_data";

export type FunctionSeed = {
  start: HexAddress;
  name: string;
  kind: "entry" | "export" | "tls" | "exception" | "pdb" | "call";
};

export type SectionInfo = {
  name: string;
  startVa: HexAddress;
  endVa: HexAddress;
  rawOffset: number;
  rawSize: number;
};

export type MemoryOverviewSliceKind =
  | "unmapped"
  | "ro"
  | "rw"
  | "rwx"
  | "explored"
  | "unexplored";

export type ModuleAnalysisStatus = {
  state:
    | "queued"
    | "discovering_functions"
    | "analyzing_functions"
    | "finalizing_linear_view"
    | "ready"
    | "failed"
    | "canceled";
  message: string;
  discoveredFunctionCount: number;
  totalFunctionCount?: number;
  analyzedFunctionCount?: number;
};

export type ImportInfo = {
  library: string;
  name: string;
  addressVa: HexAddress;
};

export type ExportInfo = {
  name: string;
  start: HexAddress;
};

export type InstructionCategory =
  | "call"
  | "return"
  | "control_flow"
  | "system"
  | "stack"
  | "string"
  | "compare_test"
  | "arithmetic"
  | "logic"
  | "bit_shift"
  | "data_transfer"
  | "other";

export type FunctionGraphInstruction = {
  address: HexAddress;
  mnemonic: string;
  operands: string;
  instructionCategory: InstructionCategory;
  branchTarget?: HexAddress;
  callTarget?: HexAddress;
};

export type FunctionGraphBlock = {
  id: string;
  startVa: HexAddress;
  endVa: HexAddress;
  isEntry: boolean;
  isExit: boolean;
  instructions: FunctionGraphInstruction[];
};

export type FunctionGraphEdge = {
  id: string;
  fromBlockId: string;
  toBlockId: string;
  kind: "conditional" | "unconditional" | "fallthrough";
  sourceInstructionVa: HexAddress;
  isBackEdge: boolean;
};

export type XrefKind = "call" | "jump" | "branch" | "data";

export type XrefTargetKind = "code" | "data";

export type XrefRecord = {
  sourceVa: HexAddress;
  sourceFunctionStartVa: HexAddress;
  sourceFunctionName: string;
  kind: XrefKind;
  targetVa: HexAddress;
  targetKind: XrefTargetKind;
};

export type LinearInstruction = {
  address: HexAddress;
  bytes: string;
  mnemonic: string;
  operands: string;
  instructionCategory: InstructionCategory;
  branchTarget?: HexAddress;
  callTarget?: HexAddress;
  comment?: string;
};

export type LinearRow = {
  kind: "instruction" | "data" | "gap";
  address: HexAddress;
  bytes: string;
  mnemonic: string;
  operands: string;
  instructionCategory?: InstructionCategory;
  branchTarget?: HexAddress;
  callTarget?: HexAddress;
  comment?: string;
};

export type MethodResult = {
  "module.open": {
    moduleId: string;
    arch: "x64";
    imageBase: HexAddress;
    entryVa: HexAddress;
  };
  "module.getPdbStatus": {
    status: "not_applicable" | "auto_found" | "needs_manual";
    embeddedPath?: string;
  };
  "module.unload": Record<string, never>;
  "module.getAnalysisStatus": ModuleAnalysisStatus;
  "module.info": {
    sections: SectionInfo[];
    imports: ImportInfo[];
    exports: ExportInfo[];
  };
  "module.getMemoryOverview": {
    startVa: HexAddress;
    endVa: HexAddress;
    slices: MemoryOverviewSliceKind[];
  };
  "function.list": {
    functions: FunctionSeed[];
  };
  "function.getGraphByVa": {
    functionStartVa: HexAddress;
    functionName: string;
    focusBlockId: string;
    blocks: FunctionGraphBlock[];
    edges: FunctionGraphEdge[];
  };
  "xref.getXrefsToVa": {
    targetVa: HexAddress;
    xrefs: XrefRecord[];
  };
  "function.disassembleLinear": {
    instructions: LinearInstruction[];
    stopReason: StopReason;
  };
  "linear.getViewInfo": {
    rowCount: number;
    minVa: HexAddress;
    maxVa: HexAddress;
    rowHeight: number;
    dataGroupSize: number;
  };
  "linear.getRows": {
    rows: LinearRow[];
  };
  "linear.findRowByVa": {
    rowIndex: number;
  };
};
