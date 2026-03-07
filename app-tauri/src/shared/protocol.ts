import type {
  EnginePingParams,
  FunctionGraphByVaParams,
  FunctionListParams,
  LinearDisassemblyParams,
  ModuleInfoParams,
  ModuleOpenParams,
} from "./protocol.gen";

export type HexAddress = string;

export type EngineMethod =
  | "engine.ping"
  | "module.open"
  | "module.unload"
  | "module.getAnalysisStatus"
  | "module.info"
  | "function.list"
  | "function.getGraphByVa"
  | "function.disassembleLinear"
  | "linear.getViewInfo"
  | "linear.getRows"
  | "linear.findRowByVa";

export type MethodParams = {
  "engine.ping": EnginePingParams;
  "module.open": ModuleOpenParams;
  "module.unload": {
    moduleId: string;
  };
  "module.getAnalysisStatus": {
    moduleId: string;
  };
  "module.info": ModuleInfoParams;
  "function.list": FunctionListParams;
  "function.getGraphByVa": FunctionGraphByVaParams;
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
  kind: "entry" | "export" | "tls" | "exception" | "pdb";
};

export type SectionInfo = {
  name: string;
  startVa: HexAddress;
  endVa: HexAddress;
  rawOffset: number;
  rawSize: number;
};

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
  mnemonic: string;
  operands: string;
  instructionCategory: InstructionCategory;
};

export type FunctionGraphBlock = {
  id: string;
  startVa: HexAddress;
  instructions: FunctionGraphInstruction[];
};

export type FunctionGraphEdge = {
  fromBlockId: string;
  toBlockId: string;
  kind: "conditional" | "unconditional" | "fallthrough";
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
  "engine.ping": {
    version: string;
  };
  "module.open": {
    moduleId: string;
    arch: "x64";
    imageBase: HexAddress;
    entryVa: HexAddress;
  };
  "module.unload": Record<string, never>;
  "module.getAnalysisStatus": ModuleAnalysisStatus;
  "module.info": {
    sections: SectionInfo[];
    imports: ImportInfo[];
    exports: ExportInfo[];
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

export type WindowControlAction = "minimize" | "toggleMaximize" | "close";

export type WindowChromeState = {
  useCustomChrome: boolean;
  platform: string;
  isMaximized: boolean;
  isFocused: boolean;
};

export type TitleBarMenuItem =
  | {
      type: "item";
      label: string;
      enabled: boolean;
      commandId?: string;
      accelerator?: string;
    }
  | {
      type: "separator";
    }
  | {
      type: "submenu";
      label: string;
      enabled: boolean;
      items: TitleBarMenuItem[];
    };

export type TitleBarMenu = {
  id: string;
  label: string;
  items: TitleBarMenuItem[];
};

export type TitleBarMenuModel = {
  menus: TitleBarMenu[];
};

export type DesktopApi = {
  pickExecutable: () => Promise<string | null>;
  onMenuOpenExecutable: (callback: () => void) => () => void;
  onMenuOpenRecentExecutable: (callback: (path: string) => void) => () => void;
  onMenuUnloadModule: (callback: () => void) => () => void;
  addRecentExecutable: (path: string) => Promise<void>;
  getWindowChromeState: () => Promise<WindowChromeState>;
  onWindowChromeStateChanged: (
    callback: (state: WindowChromeState) => void,
  ) => () => void;
  windowControl: (action: WindowControlAction) => Promise<void>;
  getTitleBarMenuModel: () => Promise<TitleBarMenuModel>;
  onTitleBarMenuModelChanged: (
    callback: (model: TitleBarMenuModel) => void,
  ) => () => void;
  invokeTitleBarMenuAction: (commandId: string) => Promise<void>;
  pingEngine: () => Promise<MethodResult["engine.ping"]>;
  openModule: (path: string) => Promise<MethodResult["module.open"]>;
  unloadModule: (moduleId: string) => Promise<MethodResult["module.unload"]>;
  getModuleAnalysisStatus: (
    moduleId: string,
  ) => Promise<MethodResult["module.getAnalysisStatus"]>;
  getModuleInfo: (moduleId: string) => Promise<MethodResult["module.info"]>;
  listFunctions: (moduleId: string) => Promise<MethodResult["function.list"]>;
  getFunctionGraphByVa: (
    payload: MethodParams["function.getGraphByVa"],
  ) => Promise<MethodResult["function.getGraphByVa"]>;
  disassembleLinear: (
    payload: MethodParams["function.disassembleLinear"],
  ) => Promise<MethodResult["function.disassembleLinear"]>;
  getLinearViewInfo: (
    moduleId: string,
  ) => Promise<MethodResult["linear.getViewInfo"]>;
  getLinearRows: (
    payload: MethodParams["linear.getRows"],
  ) => Promise<MethodResult["linear.getRows"]>;
  findLinearRowByVa: (
    payload: MethodParams["linear.findRowByVa"],
  ) => Promise<MethodResult["linear.findRowByVa"]>;
};
