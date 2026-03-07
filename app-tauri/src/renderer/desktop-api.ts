import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  DesktopApi,
  EngineMethod,
  MethodParams,
  MethodResult,
  TitleBarMenuModel,
  WindowChromeState,
  WindowControlAction,
} from "../shared/protocol";

const WINDOW_CHROME_STATE_CHANGED_EVENT = "app://window-chrome-state-changed";
const TITLE_BAR_MENU_MODEL_CHANGED_EVENT = "app://title-bar-menu-model-changed";
const MENU_OPEN_EXECUTABLE_EVENT = "app://menu-open-executable";
const MENU_OPEN_RECENT_EXECUTABLE_EVENT = "app://menu-open-recent-executable";
const MENU_UNLOAD_MODULE_EVENT = "app://menu-unload-module";

function subscribe<T>(
  eventName: string,
  callback: (payload: T) => void,
): () => void {
  let unlisten: (() => void) | null = null;
  let active = true;

  void listen<T>(eventName, (event) => {
    if (!active) {
      return;
    }
    callback(event.payload);
  })
    .then((cleanup) => {
      if (!active) {
        cleanup();
        return;
      }
      unlisten = cleanup;
    })
    .catch((error: unknown) => {
      console.error(`Failed to subscribe to '${eventName}'`, error);
    });

  return () => {
    active = false;
    unlisten?.();
    unlisten = null;
  };
}

function invokeApp<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(command, args);
}

function requestEngine<M extends EngineMethod>(
  method: M,
  params: MethodParams[M],
): Promise<MethodResult[M]> {
  return invokeApp<MethodResult[M]>("engine_request", { method, params });
}

export const desktopApi: DesktopApi = {
  pickExecutable: () => invokeApp<string | null>("pick_executable"),
  addRecentExecutable: (path: string) =>
    invokeApp<void>("add_recent_executable", { path }),
  getWindowChromeState: () =>
    invokeApp<WindowChromeState>("get_window_chrome_state"),
  onWindowChromeStateChanged: (callback) =>
    subscribe<WindowChromeState>(WINDOW_CHROME_STATE_CHANGED_EVENT, callback),
  windowControl: (action: WindowControlAction) =>
    invokeApp<void>("window_control", { action }),
  getTitleBarMenuModel: () =>
    invokeApp<TitleBarMenuModel>("get_title_bar_menu_model"),
  onTitleBarMenuModelChanged: (callback) =>
    subscribe<TitleBarMenuModel>(TITLE_BAR_MENU_MODEL_CHANGED_EVENT, callback),
  invokeTitleBarMenuAction: (commandId: string) =>
    invokeApp<void>("invoke_title_bar_menu_action", { commandId }),
  onMenuOpenExecutable: (callback) =>
    subscribe<null>(MENU_OPEN_EXECUTABLE_EVENT, () => {
      callback();
    }),
  onMenuOpenRecentExecutable: (callback) =>
    subscribe<string>(MENU_OPEN_RECENT_EXECUTABLE_EVENT, callback),
  onMenuUnloadModule: (callback) =>
    subscribe<null>(MENU_UNLOAD_MODULE_EVENT, () => {
      callback();
    }),
  pingEngine: () => requestEngine("engine.ping", {}),
  openModule: (path: string) => requestEngine("module.open", { path }),
  unloadModule: (moduleId: string) =>
    requestEngine("module.unload", { moduleId }),
  getModuleAnalysisStatus: (moduleId: string) =>
    requestEngine("module.getAnalysisStatus", { moduleId }),
  getModuleInfo: (moduleId: string) =>
    requestEngine("module.info", { moduleId }),
  listFunctions: (moduleId: string) =>
    requestEngine("function.list", { moduleId }),
  getFunctionGraphByVa: (payload) =>
    requestEngine("function.getGraphByVa", payload),
  disassembleLinear: (payload) =>
    requestEngine("function.disassembleLinear", payload),
  getLinearViewInfo: (moduleId: string) =>
    requestEngine("linear.getViewInfo", { moduleId }),
  getLinearRows: (payload) => requestEngine("linear.getRows", payload),
  findLinearRowByVa: (payload) => requestEngine("linear.findRowByVa", payload),
};
