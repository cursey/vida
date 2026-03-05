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

function sendOpenExecutableMenuEvent(): void {
  const targetWindow =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  targetWindow?.webContents.send("app:menu-open-executable");
}

function setApplicationMenu(): void {
  const fileSubmenu: MenuItemConstructorOptions[] = [
    {
      label: "Open...",
      accelerator: "CmdOrCtrl+O",
      click: () => {
        sendOpenExecutableMenuEvent();
      },
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
