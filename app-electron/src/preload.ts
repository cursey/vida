import { contextBridge, ipcRenderer } from "electron";
import type {
  ElectronApi,
  MethodParams,
  MethodResult,
  TitleBarMenuModel,
  WindowChromeState,
  WindowControlAction,
} from "./shared/protocol";

const electronApi: ElectronApi = {
  pickExecutable: (): Promise<string | null> =>
    ipcRenderer.invoke("app:pickExecutable"),
  addRecentExecutable: (path: string): Promise<void> =>
    ipcRenderer.invoke("app:addRecentExecutable", path),
  getWindowChromeState: (): Promise<WindowChromeState> =>
    ipcRenderer.invoke("app:getWindowChromeState"),
  onWindowChromeStateChanged: (
    callback: (state: WindowChromeState) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: WindowChromeState,
    ): void => {
      callback(state);
    };
    ipcRenderer.on("app:window-chrome-state-changed", listener);
    return () => {
      ipcRenderer.removeListener("app:window-chrome-state-changed", listener);
    };
  },
  windowControl: (action: WindowControlAction): Promise<void> =>
    ipcRenderer.invoke("app:windowControl", action),
  getTitleBarMenuModel: (): Promise<TitleBarMenuModel> =>
    ipcRenderer.invoke("app:getTitleBarMenuModel"),
  onTitleBarMenuModelChanged: (
    callback: (model: TitleBarMenuModel) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      model: TitleBarMenuModel,
    ): void => {
      callback(model);
    };
    ipcRenderer.on("app:title-bar-menu-model-changed", listener);
    return () => {
      ipcRenderer.removeListener("app:title-bar-menu-model-changed", listener);
    };
  },
  invokeTitleBarMenuAction: (commandId: string): Promise<void> =>
    ipcRenderer.invoke("app:invokeTitleBarMenuAction", commandId),
  onMenuOpenExecutable: (callback: () => void): (() => void) => {
    const listener = (): void => {
      callback();
    };
    ipcRenderer.on("app:menu-open-executable", listener);
    return () => {
      ipcRenderer.removeListener("app:menu-open-executable", listener);
    };
  },
  onMenuOpenRecentExecutable: (
    callback: (path: string) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      selectedPath: string,
    ): void => {
      callback(selectedPath);
    };
    ipcRenderer.on("app:menu-open-recent-executable", listener);
    return () => {
      ipcRenderer.removeListener("app:menu-open-recent-executable", listener);
    };
  },
  onMenuUnloadModule: (callback: () => void): (() => void) => {
    const listener = (): void => {
      callback();
    };
    ipcRenderer.on("app:menu-unload-module", listener);
    return () => {
      ipcRenderer.removeListener("app:menu-unload-module", listener);
    };
  },
  pingEngine: (): Promise<MethodResult["engine.ping"]> =>
    ipcRenderer.invoke("engine:ping"),
  openModule: (path: string): Promise<MethodResult["module.open"]> =>
    ipcRenderer.invoke("engine:openModule", path),
  unloadModule: (moduleId: string): Promise<MethodResult["module.unload"]> =>
    ipcRenderer.invoke("engine:unloadModule", moduleId),
  getModuleAnalysisStatus: (
    moduleId: string,
  ): Promise<MethodResult["module.getAnalysisStatus"]> =>
    ipcRenderer.invoke("engine:getModuleAnalysisStatus", moduleId),
  getModuleInfo: (moduleId: string): Promise<MethodResult["module.info"]> =>
    ipcRenderer.invoke("engine:getModuleInfo", moduleId),
  listFunctions: (moduleId: string): Promise<MethodResult["function.list"]> =>
    ipcRenderer.invoke("engine:listFunctions", moduleId),
  getFunctionGraphByVa: (
    payload: MethodParams["function.getGraphByVa"],
  ): Promise<MethodResult["function.getGraphByVa"]> =>
    ipcRenderer.invoke("engine:getFunctionGraphByVa", payload),
  disassembleLinear: (
    payload: MethodParams["function.disassembleLinear"],
  ): Promise<MethodResult["function.disassembleLinear"]> =>
    ipcRenderer.invoke("engine:disassembleLinear", payload),
  getLinearViewInfo: (
    moduleId: string,
  ): Promise<MethodResult["linear.getViewInfo"]> =>
    ipcRenderer.invoke("engine:getLinearViewInfo", moduleId),
  getLinearRows: (
    payload: MethodParams["linear.getRows"],
  ): Promise<MethodResult["linear.getRows"]> =>
    ipcRenderer.invoke("engine:getLinearRows", payload),
  findLinearRowByVa: (
    payload: MethodParams["linear.findRowByVa"],
  ): Promise<MethodResult["linear.findRowByVa"]> =>
    ipcRenderer.invoke("engine:findLinearRowByVa", payload),
};

contextBridge.exposeInMainWorld("electronAPI", electronApi);
