import path from "node:path";
import { BrowserWindow, app, dialog, ipcMain } from "electron";
import type { MethodParams } from "../shared/protocol";
import { EngineClient } from "./engineClient";

const engineClient = new EngineClient();

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

app.whenReady().then(async () => {
  engineClient.start();
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
