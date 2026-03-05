import type { ElectronApi } from "../shared/protocol";

declare global {
  interface Window {
    electronAPI: ElectronApi;
  }
}
