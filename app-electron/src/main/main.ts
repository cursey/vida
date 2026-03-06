import fs from "node:fs";
import path from "node:path";
import {
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  app,
  dialog,
  ipcMain,
} from "electron";
import type {
  MethodParams,
  TitleBarMenu,
  TitleBarMenuItem,
  TitleBarMenuModel,
  WindowChromeState,
  WindowControlAction,
} from "../shared/protocol";
import { EngineClient } from "./engineClient";

const engineClient = new EngineClient();
const MAX_RECENT_EXECUTABLES = 10;
const RECENT_EXECUTABLES_FILE_NAME = "recent-executables.json";
const IS_MAC = process.platform === "darwin";
const USE_CUSTOM_CHROME = true;
const FILE_MENU_ID = "file";
const FILE_OPEN_COMMAND_ID = "file.open";
const FILE_OPEN_RECENT_COMMAND_PREFIX = "file.openRecent.";
const FILE_UNLOAD_COMMAND_ID = "file.unload";
const FILE_CLOSE_OR_QUIT_COMMAND_ID = "file.closeOrQuit";

let recentExecutables: string[] = [];
let titleBarMenuModel: TitleBarMenuModel = { menus: [] };
let menuActionHandlers = new Map<
  string,
  (targetWindow?: BrowserWindow | undefined) => void
>();

function resolveTargetWindow(
  preferredWindow?: BrowserWindow,
): BrowserWindow | undefined {
  if (preferredWindow && !preferredWindow.isDestroyed()) {
    return preferredWindow;
  }
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

function resolveMenuClickWindow(
  sourceWindow?: { id: number } | null,
): BrowserWindow | undefined {
  if (!sourceWindow) {
    return undefined;
  }
  return BrowserWindow.fromId(sourceWindow.id) ?? undefined;
}

function sendOpenExecutableMenuEvent(targetWindow?: BrowserWindow): void {
  resolveTargetWindow(targetWindow)?.webContents.send(
    "app:menu-open-executable",
  );
}

function sendOpenRecentExecutableMenuEvent(
  executablePath: string,
  targetWindow?: BrowserWindow,
): void {
  resolveTargetWindow(targetWindow)?.webContents.send(
    "app:menu-open-recent-executable",
    executablePath,
  );
}

function sendUnloadModuleMenuEvent(targetWindow?: BrowserWindow): void {
  resolveTargetWindow(targetWindow)?.webContents.send("app:menu-unload-module");
}

function getRecentExecutablesFilePath(): string {
  return path.join(app.getPath("userData"), RECENT_EXECUTABLES_FILE_NAME);
}

function normalizeExecutablePath(executablePath: string): string {
  const trimmedPath = executablePath.trim();
  if (trimmedPath.length === 0) {
    return "";
  }
  return path.resolve(trimmedPath);
}

function isExistingFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function sanitizeRecentExecutables(paths: string[]): string[] {
  const unique = new Set<string>();
  const output: string[] = [];

  for (const rawPath of paths) {
    if (typeof rawPath !== "string" || rawPath.trim().length === 0) {
      continue;
    }

    const normalizedPath = normalizeExecutablePath(rawPath);
    if (
      !normalizedPath ||
      !isExistingFile(normalizedPath) ||
      unique.has(normalizedPath)
    ) {
      continue;
    }

    unique.add(normalizedPath);
    output.push(normalizedPath);

    if (output.length >= MAX_RECENT_EXECUTABLES) {
      break;
    }
  }

  return output;
}

function saveRecentExecutables(): void {
  const outputPath = getRecentExecutablesFilePath();

  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(
      outputPath,
      JSON.stringify({ paths: recentExecutables }, null, 2),
      "utf8",
    );
  } catch (error) {
    console.warn("Failed to persist recent executables:", error);
  }
}

function loadRecentExecutables(): void {
  const inputPath = getRecentExecutablesFilePath();
  if (!fs.existsSync(inputPath)) {
    recentExecutables = [];
    return;
  }

  try {
    const raw = fs.readFileSync(inputPath, "utf8");
    const parsed = JSON.parse(raw) as { paths?: string[] };
    const loadedPaths = Array.isArray(parsed.paths) ? parsed.paths : [];
    recentExecutables = sanitizeRecentExecutables(loadedPaths);
  } catch (error) {
    console.warn("Failed to load recent executables:", error);
    recentExecutables = [];
  }
}

function sendTitleBarMenuModelToWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  window.webContents.send(
    "app:title-bar-menu-model-changed",
    titleBarMenuModel,
  );
}

function broadcastTitleBarMenuModel(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    sendTitleBarMenuModelToWindow(window);
  }
}

function getWindowChromeState(window: BrowserWindow): WindowChromeState {
  return {
    useCustomChrome: USE_CUSTOM_CHROME,
    platform: process.platform,
    isMaximized: window.isMaximized(),
    isFocused: window.isFocused(),
  };
}

function sendWindowChromeState(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  window.webContents.send(
    "app:window-chrome-state-changed",
    getWindowChromeState(window),
  );
}

function applyWindowChromeMenuVisibility(window: BrowserWindow): void {
  if (!USE_CUSTOM_CHROME || IS_MAC || window.isDestroyed()) {
    return;
  }
  window.setAutoHideMenuBar(false);
  window.setMenuBarVisibility(false);
}

function registerMenuAction(
  commandId: string,
  handler: (targetWindow?: BrowserWindow) => void,
): void {
  menuActionHandlers.set(commandId, handler);
}

function invokeMenuAction(
  commandId: string,
  targetWindow?: BrowserWindow,
): void {
  const handler = menuActionHandlers.get(commandId);
  if (!handler) {
    console.warn(`No title bar menu action found for commandId: ${commandId}`);
    return;
  }
  handler(targetWindow);
}

function buildOpenRecentMenuEntries(): {
  native: MenuItemConstructorOptions[];
  model: TitleBarMenuItem[];
} {
  if (recentExecutables.length === 0) {
    return {
      native: [{ label: "No Recent Files", enabled: false }],
      model: [{ type: "item", label: "No Recent Files", enabled: false }],
    };
  }

  const native: MenuItemConstructorOptions[] = [];
  const model: TitleBarMenuItem[] = [];

  recentExecutables.forEach((recentPath, index) => {
    const commandId = `${FILE_OPEN_RECENT_COMMAND_PREFIX}${index}`;
    registerMenuAction(commandId, (targetWindow) => {
      sendOpenRecentExecutableMenuEvent(recentPath, targetWindow);
    });

    native.push({
      label: recentPath,
      click: (_menuItem, browserWindow) => {
        invokeMenuAction(commandId, resolveMenuClickWindow(browserWindow));
      },
    });

    model.push({
      type: "item",
      label: recentPath,
      enabled: true,
      commandId,
    });
  });

  return { native, model };
}

function buildFileMenuDefinition(): {
  nativeSubmenu: MenuItemConstructorOptions[];
  modelMenu: TitleBarMenu;
} {
  const openRecent = buildOpenRecentMenuEntries();

  registerMenuAction(FILE_OPEN_COMMAND_ID, (targetWindow) => {
    sendOpenExecutableMenuEvent(targetWindow);
  });
  registerMenuAction(FILE_UNLOAD_COMMAND_ID, (targetWindow) => {
    sendUnloadModuleMenuEvent(targetWindow);
  });
  registerMenuAction(FILE_CLOSE_OR_QUIT_COMMAND_ID, (targetWindow) => {
    if (IS_MAC) {
      resolveTargetWindow(targetWindow)?.close();
      return;
    }
    app.quit();
  });

  const closeOrQuitLabel = IS_MAC ? "Close Window" : "Quit";
  const closeOrQuitAccelerator = IS_MAC ? "CmdOrCtrl+W" : "Alt+F4";

  const nativeSubmenu: MenuItemConstructorOptions[] = [
    {
      label: "Open...",
      accelerator: "CmdOrCtrl+O",
      click: (_menuItem, browserWindow) => {
        invokeMenuAction(
          FILE_OPEN_COMMAND_ID,
          resolveMenuClickWindow(browserWindow),
        );
      },
    },
    {
      label: "Open Recent",
      submenu: openRecent.native,
    },
    {
      label: "Unload",
      click: (_menuItem, browserWindow) => {
        invokeMenuAction(
          FILE_UNLOAD_COMMAND_ID,
          resolveMenuClickWindow(browserWindow),
        );
      },
    },
    { type: "separator" },
    {
      label: closeOrQuitLabel,
      accelerator: closeOrQuitAccelerator,
      click: (_menuItem, browserWindow) => {
        invokeMenuAction(
          FILE_CLOSE_OR_QUIT_COMMAND_ID,
          resolveMenuClickWindow(browserWindow),
        );
      },
    },
  ];

  const modelMenu: TitleBarMenu = {
    id: FILE_MENU_ID,
    label: "File",
    items: [
      {
        type: "item",
        label: "Open...",
        enabled: true,
        commandId: FILE_OPEN_COMMAND_ID,
        accelerator: "CmdOrCtrl+O",
      },
      {
        type: "submenu",
        label: "Open Recent",
        enabled: true,
        items: openRecent.model,
      },
      {
        type: "item",
        label: "Unload",
        enabled: true,
        commandId: FILE_UNLOAD_COMMAND_ID,
      },
      { type: "separator" },
      {
        type: "item",
        label: closeOrQuitLabel,
        enabled: true,
        commandId: FILE_CLOSE_OR_QUIT_COMMAND_ID,
        accelerator: closeOrQuitAccelerator,
      },
    ],
  };

  return { nativeSubmenu, modelMenu };
}

function setApplicationMenu(): void {
  const sanitizedRecentPaths = sanitizeRecentExecutables(recentExecutables);
  if (sanitizedRecentPaths.length !== recentExecutables.length) {
    recentExecutables = sanitizedRecentPaths;
    saveRecentExecutables();
  }

  menuActionHandlers = new Map();
  const fileMenuDefinition = buildFileMenuDefinition();

  const template: MenuItemConstructorOptions[] = IS_MAC
    ? [
        { role: "appMenu" },
        { label: "File", submenu: fileMenuDefinition.nativeSubmenu },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]
    : [
        { label: "File", submenu: fileMenuDefinition.nativeSubmenu },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  titleBarMenuModel = { menus: [fileMenuDefinition.modelMenu] };
  broadcastTitleBarMenuModel();

  for (const window of BrowserWindow.getAllWindows()) {
    applyWindowChromeMenuVisibility(window);
  }
}

function setRecentExecutables(paths: string[]): void {
  recentExecutables = sanitizeRecentExecutables(paths);
  saveRecentExecutables();
  setApplicationMenu();
}

function addRecentExecutable(executablePath: string): void {
  const normalizedPath = normalizeExecutablePath(executablePath);
  if (!normalizedPath || !isExistingFile(normalizedPath)) {
    return;
  }

  setRecentExecutables([normalizedPath, ...recentExecutables]);
}

function attachWindowChromeEvents(window: BrowserWindow): void {
  const emitState = (): void => {
    sendWindowChromeState(window);
  };

  window.on("focus", emitState);
  window.on("blur", emitState);
  window.on("maximize", emitState);
  window.on("unmaximize", emitState);
  window.on("enter-full-screen", emitState);
  window.on("leave-full-screen", emitState);
  window.on("restore", emitState);
  window.webContents.on("did-finish-load", () => {
    emitState();
    sendTitleBarMenuModelToWindow(window);
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1500,
    height: 950,
    frame: !USE_CUSTOM_CHROME,
    ...(IS_MAC && USE_CUSTOM_CHROME
      ? ({ titleBarStyle: "hidden" } as const)
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  attachWindowChromeEvents(window);
  applyWindowChromeMenuVisibility(window);

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    window.loadURL(devServerUrl);
    return;
  }

  window.loadFile(path.join(__dirname, "../renderer/index.html"));
}

ipcMain.handle("app:pickExecutable", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open executable",
    filters: [{ name: "Windows Executable", extensions: ["exe"] }],
    properties: ["openFile"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle(
  "app:addRecentExecutable",
  async (_event, executablePath: string) => {
    addRecentExecutable(executablePath);
  },
);

ipcMain.handle("app:getWindowChromeState", async (event) => {
  const senderWindow =
    BrowserWindow.fromWebContents(event.sender) ?? resolveTargetWindow();
  if (!senderWindow) {
    return {
      useCustomChrome: USE_CUSTOM_CHROME,
      platform: process.platform,
      isMaximized: false,
      isFocused: false,
    } satisfies WindowChromeState;
  }
  return getWindowChromeState(senderWindow);
});

ipcMain.handle(
  "app:windowControl",
  async (event, action: WindowControlAction) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      return;
    }

    switch (action) {
      case "minimize":
        senderWindow.minimize();
        break;
      case "toggleMaximize":
        if (senderWindow.isMaximized()) {
          senderWindow.unmaximize();
        } else {
          senderWindow.maximize();
        }
        break;
      case "close":
        senderWindow.close();
        break;
      default:
        break;
    }
  },
);

ipcMain.handle("app:getTitleBarMenuModel", async () => {
  return titleBarMenuModel;
});

ipcMain.handle(
  "app:invokeTitleBarMenuAction",
  async (event, commandId: string) => {
    const senderWindow =
      BrowserWindow.fromWebContents(event.sender) ?? resolveTargetWindow();
    invokeMenuAction(commandId, senderWindow);
  },
);

ipcMain.handle("engine:ping", async () => {
  return engineClient.request("engine.ping", {});
});

ipcMain.handle("engine:openModule", async (_event, pathValue: string) => {
  return engineClient.request("module.open", { path: pathValue });
});

ipcMain.handle("engine:getModuleInfo", async (_event, moduleId: string) => {
  return engineClient.request("module.info", { moduleId });
});

ipcMain.handle("engine:listFunctions", async (_event, moduleId: string) => {
  return engineClient.request("function.list", { moduleId });
});

ipcMain.handle(
  "engine:disassembleLinear",
  async (_event, payload: MethodParams["function.disassembleLinear"]) => {
    return engineClient.request("function.disassembleLinear", payload);
  },
);

ipcMain.handle("engine:getLinearViewInfo", async (_event, moduleId: string) => {
  return engineClient.request("linear.getViewInfo", { moduleId });
});

ipcMain.handle(
  "engine:getLinearRows",
  async (_event, payload: MethodParams["linear.getRows"]) => {
    return engineClient.request("linear.getRows", payload);
  },
);

ipcMain.handle(
  "engine:findLinearRowByRva",
  async (_event, payload: MethodParams["linear.findRowByRva"]) => {
    return engineClient.request("linear.findRowByRva", payload);
  },
);

app.whenReady().then(async () => {
  engineClient.start();
  loadRecentExecutables();
  setApplicationMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  engineClient.stop();
});

app.on("window-all-closed", () => {
  if (!IS_MAC) {
    app.quit();
  }
});
