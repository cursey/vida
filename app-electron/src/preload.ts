import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  pingEngine: (): Promise<string> => ipcRenderer.invoke("engine:ping"),
});
