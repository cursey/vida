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
import type { MethodParams } from "../shared/protocol";
import { EngineClient } from "./engineClient";

const engineClient = new EngineClient();
const MAX_RECENT_EXECUTABLES = 10;
const RECENT_EXECUTABLES_FILE_NAME = "recent-executables.json";

let recentExecutables: string[] = [];

function sendOpenExecutableMenuEvent(): void {
  const targetWindow =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  targetWindow?.webContents.send("app:menu-open-executable");
}

function sendOpenRecentExecutableMenuEvent(executablePath: string): void {
  const targetWindow =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  targetWindow?.webContents.send(
    "app:menu-open-recent-executable",
    executablePath,
  );
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

function buildOpenRecentSubmenu(): MenuItemConstructorOptions[] {
  if (recentExecutables.length === 0) {
    return [{ label: "No Recent Files", enabled: false }];
  }

  return recentExecutables.map((recentPath) => ({
    label: recentPath,
    click: () => {
      sendOpenRecentExecutableMenuEvent(recentPath);
    },
  }));
}

function setApplicationMenu(): void {
  const sanitizedRecentPaths = sanitizeRecentExecutables(recentExecutables);
  if (sanitizedRecentPaths.length !== recentExecutables.length) {
    recentExecutables = sanitizedRecentPaths;
    saveRecentExecutables();
  }

  const fileSubmenu: MenuItemConstructorOptions[] = [
    {
      label: "Open...",
      accelerator: "CmdOrCtrl+O",
      click: () => {
        sendOpenExecutableMenuEvent();
      },
    },
    {
      label: "Open Recent",
      submenu: buildOpenRecentSubmenu(),
    },
    { type: "separator" },
    process.platform === "darwin" ? { role: "close" } : { role: "quit" },
  ];

  const template: MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [
          { role: "appMenu" },
          { label: "File", submenu: fileSubmenu },
          { role: "editMenu" },
          { role: "viewMenu" },
          { role: "windowMenu" },
        ]
      : [
          { label: "File", submenu: fileSubmenu },
          { role: "editMenu" },
          { role: "viewMenu" },
          { role: "windowMenu" },
        ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1500,
    height: 950,
    webPreferences: {
      preload: path.join(__dirname, "../preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

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
  if (process.platform !== "darwin") {
    app.quit();
  }
});
