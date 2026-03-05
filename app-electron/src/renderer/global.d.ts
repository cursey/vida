export {};

declare global {
  interface Window {
    electronAPI: {
      pingEngine: () => Promise<string>;
    };
  }
}
