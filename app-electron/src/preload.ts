import { contextBridge, ipcRenderer } from "electron";
import type {
  ElectronApi,
  MethodParams,
  MethodResult,
} from "./shared/protocol";

const electronApi: ElectronApi = {
  pickExecutable: (): Promise<string | null> =>
    ipcRenderer.invoke("app:pickExecutable"),
  addRecentExecutable: (path: string): Promise<void> =>
    ipcRenderer.invoke("app:addRecentExecutable", path),
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
  pingEngine: (): Promise<MethodResult["engine.ping"]> =>
    ipcRenderer.invoke("engine:ping"),
  openModule: (path: string): Promise<MethodResult["module.open"]> =>
    ipcRenderer.invoke("engine:openModule", path),
  getModuleInfo: (moduleId: string): Promise<MethodResult["module.info"]> =>
    ipcRenderer.invoke("engine:getModuleInfo", moduleId),
  listFunctions: (moduleId: string): Promise<MethodResult["function.list"]> =>
    ipcRenderer.invoke("engine:listFunctions", moduleId),
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
  findLinearRowByRva: (
    payload: MethodParams["linear.findRowByRva"],
  ): Promise<MethodResult["linear.findRowByRva"]> =>
    ipcRenderer.invoke("engine:findLinearRowByRva", payload),
};

contextBridge.exposeInMainWorld("electronAPI", electronApi);
