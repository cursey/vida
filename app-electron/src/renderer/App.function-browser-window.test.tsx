import { App } from "@/App";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronApi, FunctionSeed } from "../shared/protocol";

vi.mock("@/components/mode-toggle", () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
}));

const HUGE_FUNCTION_COUNT = 150_000;
const FUNCTION_WINDOW_SIZE = 100_000;
const FUNCTION_ROW_HEIGHT = 26;

function buildFunctions(count: number): FunctionSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    start: `0x${(0x1000 + index * 0x10).toString(16)}`,
    name: `sub_${(0x1000 + index * 0x10).toString(16)}`,
    kind: "entry",
  }));
}

describe("App function browser bounded window virtualization", () => {
  let functions: FunctionSeed[] = [];
  let menuOpenHandler: (() => void) | null = null;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    menuOpenHandler = null;
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

    functions = buildFunctions(HUGE_FUNCTION_COUNT);
    const mockApi: ElectronApi = {
      pickExecutable: vi.fn().mockResolvedValue("C:\\fixtures\\sample.exe"),
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
        moduleId: "m1",
        arch: "x64",
        imageBase: "0x140000000",
        entryRva: functions[0]?.start ?? "0x1000",
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
        rowCount: 1024,
        minRva: "0x0",
        maxRva: "0x4000",
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

  it("bounds browser panel canvas height for huge function lists", async () => {
    const { container } = render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(container.textContent).toContain(
        `${HUGE_FUNCTION_COUNT} functions`,
      );
    });

    const functionList = container.querySelector(".function-list");
    expect(functionList).not.toBeNull();
    expect(functionList).toHaveAttribute(
      "style",
      `height: ${FUNCTION_WINDOW_SIZE * FUNCTION_ROW_HEIGHT}px;`,
    );
  });

  it("keeps browser search bounded and updates search result window height", async () => {
    const { container } = render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(container.textContent).toContain(
        `${HUGE_FUNCTION_COUNT} functions`,
      );
    });

    const query = "SUB_1234";
    const expectedCount = functions.filter((func) =>
      func.name.toLowerCase().includes(query.toLowerCase()),
    ).length;
    const expectedCanvasHeight =
      Math.min(expectedCount, FUNCTION_WINDOW_SIZE) * FUNCTION_ROW_HEIGHT;

    const browserPanel = container.querySelector(".panel-nav");
    expect(browserPanel).not.toBeNull();
    fireEvent.pointerDown(browserPanel as Element);
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });

    fireEvent.change(await screen.findByLabelText("Search functions"), {
      target: { value: query },
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Searching");
    });

    await waitFor(
      () => {
        expect(container.textContent).toContain(
          `${expectedCount}/${HUGE_FUNCTION_COUNT} functions`,
        );
        expect(container.textContent).not.toContain("Searching");
      },
      { timeout: 15000 },
    );

    const functionList = container.querySelector(".function-list");
    expect(functionList).not.toBeNull();
    expect(functionList).toHaveAttribute(
      "style",
      `height: ${expectedCanvasHeight}px;`,
    );
  });
});
