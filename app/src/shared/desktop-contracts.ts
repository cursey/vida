import type { MethodParams, MethodResult } from "./engine-contracts";

export type DragDropPayload = {
  paths: string[];
  position: { x: number; y: number };
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
  onDragEnter: (callback: (payload: DragDropPayload) => void) => () => void;
  onDragLeave: (callback: () => void) => () => void;
  onDragDrop: (callback: (payload: DragDropPayload) => void) => () => void;
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
  openModule: (path: string) => Promise<MethodResult["module.open"]>;
  unloadModule: (moduleId: string) => Promise<MethodResult["module.unload"]>;
  getModuleAnalysisStatus: (
    moduleId: string,
  ) => Promise<MethodResult["module.getAnalysisStatus"]>;
  getModuleInfo: (moduleId: string) => Promise<MethodResult["module.info"]>;
  getModuleMemoryOverview: (
    moduleId: string,
  ) => Promise<MethodResult["module.getMemoryOverview"]>;
  listFunctions: (moduleId: string) => Promise<MethodResult["function.list"]>;
  getFunctionGraphByVa: (
    payload: MethodParams["function.getGraphByVa"],
  ) => Promise<MethodResult["function.getGraphByVa"]>;
  getXrefsToVa: (
    payload: MethodParams["xref.getXrefsToVa"],
  ) => Promise<MethodResult["xref.getXrefsToVa"]>;
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
