import type {
  EnginePingParams,
  FunctionListParams,
  LinearDisassemblyParams,
  ModuleInfoParams,
  ModuleOpenParams,
} from "./protocol.gen";

export type HexAddress = string;

export type EngineMethod =
  | "engine.ping"
  | "module.open"
  | "module.info"
  | "function.list"
  | "function.disassembleLinear"
  | "linear.getViewInfo"
  | "linear.getRows"
  | "linear.findRowByRva";

export type MethodParams = {
  "engine.ping": EnginePingParams;
  "module.open": ModuleOpenParams;
  "module.info": ModuleInfoParams;
  "function.list": FunctionListParams;
  "function.disassembleLinear": LinearDisassemblyParams;
  "linear.getViewInfo": {
    moduleId: string;
  };
  "linear.getRows": {
    moduleId: string;
    startRow: number;
    rowCount: number;
  };
  "linear.findRowByRva": {
    moduleId: string;
    rva: HexAddress;
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
  kind: "entry" | "export" | "exception";
};

export type SectionInfo = {
  name: string;
  startRva: HexAddress;
  endRva: HexAddress;
  rawOffset: number;
  rawSize: number;
};

export type ImportInfo = {
  library: string;
  name: string;
  addressRva: HexAddress;
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
  "engine.ping": {
    version: string;
  };
  "module.open": {
    moduleId: string;
    arch: "x64";
    imageBase: HexAddress;
    entryRva: HexAddress;
  };
  "module.info": {
    sections: SectionInfo[];
    imports: ImportInfo[];
    exports: ExportInfo[];
  };
  "function.list": {
    functions: FunctionSeed[];
  };
  "function.disassembleLinear": {
    instructions: LinearInstruction[];
    stopReason: StopReason;
  };
  "linear.getViewInfo": {
    rowCount: number;
    minRva: HexAddress;
    maxRva: HexAddress;
    rowHeight: number;
    dataGroupSize: number;
  };
  "linear.getRows": {
    rows: LinearRow[];
  };
  "linear.findRowByRva": {
    rowIndex: number;
  };
};

export type ElectronApi = {
  pickExecutable: () => Promise<string | null>;
  pingEngine: () => Promise<MethodResult["engine.ping"]>;
  openModule: (path: string) => Promise<MethodResult["module.open"]>;
  getModuleInfo: (moduleId: string) => Promise<MethodResult["module.info"]>;
  listFunctions: (moduleId: string) => Promise<MethodResult["function.list"]>;
  disassembleLinear: (
    payload: MethodParams["function.disassembleLinear"],
  ) => Promise<MethodResult["function.disassembleLinear"]>;
  getLinearViewInfo: (
    moduleId: string,
  ) => Promise<MethodResult["linear.getViewInfo"]>;
  getLinearRows: (
    payload: MethodParams["linear.getRows"],
  ) => Promise<MethodResult["linear.getRows"]>;
  findLinearRowByRva: (
    payload: MethodParams["linear.findRowByRva"],
  ) => Promise<MethodResult["linear.findRowByRva"]>;
};
