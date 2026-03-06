import { App } from "@/App";
import { act, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronApi, LinearRow } from "../shared/protocol";

vi.mock("@/components/mode-toggle", () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
}));

const HUGE_ROW_COUNT = 5_570_947;
const ROW_HEIGHT = 24;
const EXPECTED_WINDOW_HEIGHT = 100_000 * ROW_HEIGHT;

function buildLinearRows(startRow: number, rowCount: number): LinearRow[] {
  return Array.from({ length: rowCount }, (_, index) => {
    const rowIndex = startRow + index;
    return {
      kind: "data",
      address: `0x${(0x140000000 + rowIndex * 16).toString(16)}`,
      bytes: "00",
      mnemonic: "db",
      operands: "0x00",
    };
  });
}

describe("App disassembly window virtualization", () => {
  let menuOpenHandler: (() => void) | null = null;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    menuOpenHandler = null;
    rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({
        x: 0,
        y: 0,
        width: 960,
        height: 640,
        top: 0,
        left: 0,
        right: 960,
        bottom: 640,
        toJSON: () => ({}),
      }));

    const mockApi: ElectronApi = {
      pickExecutable: vi.fn().mockResolvedValue("C:\\fixtures\\huge.exe"),
      addRecentExecutable: vi.fn().mockResolvedValue(undefined),
      onMenuOpenExecutable: vi.fn((callback: () => void) => {
        menuOpenHandler = callback;
        return () => {};
      }),
      onMenuOpenRecentExecutable: vi.fn(() => () => {}),
      onMenuUnloadModule: vi.fn(() => () => {}),
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
        moduleId: "huge-module",
        arch: "x64",
        imageBase: "0x140000000",
        entryVa: "0x140001000",
      }),
      getModuleInfo: vi.fn().mockResolvedValue({
        sections: [
          {
            name: ".text",
            startVa: "0x140001000",
            endVa: "0x142001000",
            rawOffset: 0,
            rawSize: 0,
          },
        ],
        imports: [],
        exports: [],
      }),
      listFunctions: vi.fn().mockResolvedValue({
        functions: [{ start: "0x140001000", name: "entry", kind: "entry" }],
      }),
      getFunctionGraphByVa: vi.fn().mockResolvedValue({
        functionStartVa: "0x140001000",
        functionName: "entry",
        focusBlockId: "b_1000",
        blocks: [],
        edges: [],
      }),
      disassembleLinear: vi.fn().mockResolvedValue({
        instructions: [],
        stopReason: "end_of_data",
      }),
      getLinearViewInfo: vi.fn().mockResolvedValue({
        rowCount: HUGE_ROW_COUNT,
        minVa: "0x140000000",
        maxVa: "0x160000000",
        rowHeight: ROW_HEIGHT,
        dataGroupSize: 16,
      }),
      getLinearRows: vi
        .fn()
        .mockImplementation(
          async (payload: { startRow: number; rowCount: number }) => ({
            rows: buildLinearRows(payload.startRow, payload.rowCount),
          }),
        ),
      findLinearRowByVa: vi.fn().mockResolvedValue({
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

  it("keeps the disassembly canvas bounded for very large row counts", async () => {
    const { container } = render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(container.textContent).toContain(`${HUGE_ROW_COUNT} rows`);
    });

    const canvas = container.querySelector(".disassembly-rows-canvas");
    expect(canvas).not.toBeNull();
    expect(canvas).toHaveAttribute(
      "style",
      `height: ${EXPECTED_WINDOW_HEIGHT}px;`,
    );
    expect(HUGE_ROW_COUNT * ROW_HEIGHT).toBeGreaterThan(EXPECTED_WINDOW_HEIGHT);
  });
});
