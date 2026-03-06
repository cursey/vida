import { App } from "@/App";
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronApi } from "../shared/protocol";

vi.mock("@/components/mode-toggle", () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
}));

describe("App loading modal", () => {
  let menuOpenHandler: (() => void) | null = null;
  let resolveOpenModule: (() => void) | null = null;

  beforeEach(() => {
    menuOpenHandler = null;
    resolveOpenModule = null;

    const mockApi: ElectronApi = {
      pickExecutable: vi.fn().mockResolvedValue("C:\\fixtures\\sample.exe"),
      onMenuOpenExecutable: vi.fn((callback: () => void) => {
        menuOpenHandler = callback;
        return () => {};
      }),
      onMenuOpenRecentExecutable: vi.fn(() => () => {}),
      onMenuUnloadModule: vi.fn(() => () => {}),
      addRecentExecutable: vi.fn().mockResolvedValue(undefined),
      getWindowChromeState: vi.fn().mockResolvedValue({
        useCustomChrome: false,
        platform: "win32",
        isMaximized: false,
        isFocused: true,
      }),
      onWindowChromeStateChanged: vi.fn(() => () => {}),
      windowControl: vi.fn().mockResolvedValue(undefined),
      getTitleBarMenuModel: vi.fn().mockResolvedValue({ menus: [] }),
      onTitleBarMenuModelChanged: vi.fn(() => () => {}),
      invokeTitleBarMenuAction: vi.fn().mockResolvedValue(undefined),
      pingEngine: vi.fn().mockResolvedValue({ version: "0.1.0" }),
      openModule: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveOpenModule = () =>
              resolve({
                moduleId: "m1",
                arch: "x64",
                imageBase: "0x140000000",
                entryVa: "0x1000",
              });
          }),
      ),
      unloadModule: vi.fn().mockResolvedValue({}),
      getModuleAnalysisStatus: vi.fn().mockResolvedValue({
        state: "ready",
        message: "Analysis ready.",
        discoveredFunctionCount: 1,
        totalFunctionCount: 1,
        analyzedFunctionCount: 1,
      }),
      getModuleInfo: vi.fn().mockResolvedValue({
        sections: [],
        imports: [],
        exports: [],
      }),
      listFunctions: vi.fn().mockResolvedValue({
        functions: [{ start: "0x1000", name: "sub_00001000", kind: "entry" }],
      }),
      getFunctionGraphByVa: vi.fn().mockResolvedValue({
        functionStartVa: "0x1000",
        functionName: "sub_00001000",
        focusBlockId: "b_1000",
        blocks: [],
        edges: [],
      }),
      disassembleLinear: vi.fn().mockResolvedValue({
        instructions: [],
        stopReason: "end_of_data",
      }),
      getLinearViewInfo: vi.fn().mockResolvedValue({
        rowCount: 0,
        minVa: "0x0",
        maxVa: "0x0",
        rowHeight: 24,
        dataGroupSize: 16,
      }),
      getLinearRows: vi.fn().mockResolvedValue({ rows: [] }),
      findLinearRowByVa: vi.fn().mockResolvedValue({ rowIndex: 0 }),
    };

    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: mockApi,
    });
  });

  it("shows a blocking file loading modal while opening a module", async () => {
    render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(screen.getByText("Opening File")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Reading the selected file and preparing the workspace. Analysis will continue in the background.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("C:\\fixtures\\sample.exe")).toBeInTheDocument();
      expect(document.querySelector(".loading-spinner")).not.toBeNull();
    });

    await act(async () => {
      resolveOpenModule?.();
    });

    await waitFor(() => {
      expect(screen.queryByText("Opening File")).not.toBeInTheDocument();
    });
  });
});
