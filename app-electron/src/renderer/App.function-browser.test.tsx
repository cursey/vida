import { App } from "@/App";
import { act, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronApi, FunctionSeed } from "../shared/protocol";

vi.mock("@/components/mode-toggle", () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
}));

const FUNCTION_COUNT = 2000;

function buildFunctions(count: number): FunctionSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    start: `0x${(0x1000 + index * 0x10).toString(16)}`,
    name: `sub_${(0x1000 + index * 0x10).toString(16)}`,
    kind: "entry",
  }));
}

describe("App function browser virtualization", () => {
  let menuOpenHandler: (() => void) | null = null;
  let menuOpenRecentHandler: ((path: string) => void) | null = null;
  let menuUnloadHandler: (() => void) | null = null;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    menuOpenHandler = null;
    menuOpenRecentHandler = null;
    menuUnloadHandler = null;
    rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({
        x: 0,
        y: 0,
        width: 320,
        height: 320,
        top: 0,
        left: 0,
        right: 320,
        bottom: 320,
        toJSON: () => ({}),
      }));

    const functions = buildFunctions(FUNCTION_COUNT);
    const mockApi: ElectronApi = {
      pickExecutable: vi.fn().mockResolvedValue("C:\\fixtures\\sample.exe"),
      onMenuOpenExecutable: vi.fn((callback: () => void) => {
        menuOpenHandler = callback;
        return () => {};
      }),
      onMenuOpenRecentExecutable: vi.fn((callback: (path: string) => void) => {
        menuOpenRecentHandler = callback;
        return () => {};
      }),
      onMenuUnloadModule: vi.fn((callback: () => void) => {
        menuUnloadHandler = callback;
        return () => {};
      }),
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
      openModule: vi.fn().mockResolvedValue({
        moduleId: "m1",
        arch: "x64",
        imageBase: "0x140000000",
        entryRva: functions[0].start,
      }),
      getModuleInfo: vi.fn().mockResolvedValue({
        sections: [],
        imports: [],
        exports: [],
      }),
      listFunctions: vi.fn().mockResolvedValue({
        functions,
      }),
      disassembleLinear: vi.fn().mockResolvedValue({
        instructions: [],
        stopReason: "end_of_data",
      }),
      getLinearViewInfo: vi.fn().mockResolvedValue({
        rowCount: 0,
        minRva: "0x0",
        maxRva: "0x0",
        rowHeight: 24,
        dataGroupSize: 16,
      }),
      getLinearRows: vi.fn().mockResolvedValue({
        rows: [],
      }),
      findLinearRowByRva: vi.fn().mockResolvedValue({
        rowIndex: 0,
      }),
    };

    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: mockApi,
    });
  });

  afterEach(() => {
    rectSpy.mockRestore();
  });

  it("renders only a windowed subset of function rows for large datasets", async () => {
    const { container } = render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    expect(menuOpenRecentHandler).toBeTypeOf("function");
    expect(menuUnloadHandler).toBeTypeOf("function");

    await waitFor(() => {
      expect(container.textContent).toContain(`${FUNCTION_COUNT} functions`);
      expect(container.querySelector(".function-list")).toHaveAttribute(
        "style",
        `height: ${FUNCTION_COUNT * 26}px;`,
      );
    });

    const renderedRowCount = container.querySelectorAll(".function-row").length;
    expect(renderedRowCount).toBeLessThan(FUNCTION_COUNT);

    await act(async () => {
      menuUnloadHandler?.();
    });

    await waitFor(() => {
      expect(container.textContent).not.toContain("0 functions");
      expect(container.textContent).not.toContain("No module");
    });
  });
});
