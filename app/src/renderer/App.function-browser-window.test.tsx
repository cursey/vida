import { App } from "@/App";
import { createMockDesktopApi } from "@/test/mock-desktop-api";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, FunctionSeed } from "../shared/protocol";

vi.mock("@/components/mode-toggle", () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
}));

let mockDesktopApi: DesktopApi;

vi.mock("@/desktop-api", () => ({
  get desktopApi() {
    return mockDesktopApi;
  },
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
    mockDesktopApi = createMockDesktopApi({
      pickExecutable: vi.fn().mockResolvedValue("C:\\fixtures\\sample.exe"),
      onMenuOpenExecutable: vi.fn((callback: () => void) => {
        menuOpenHandler = callback;
        return () => {};
      }),
      openModule: vi.fn().mockResolvedValue({
        moduleId: "m1",
        arch: "x64",
        imageBase: "0x140000000",
        entryVa: functions[0]?.start ?? "0x1000",
      }),
      unloadModule: vi.fn().mockResolvedValue({}),
      getModuleAnalysisStatus: vi.fn().mockResolvedValue({
        state: "ready",
        message: "Analysis ready.",
        discoveredFunctionCount: HUGE_FUNCTION_COUNT,
        totalFunctionCount: HUGE_FUNCTION_COUNT,
        analyzedFunctionCount: HUGE_FUNCTION_COUNT,
      }),
      getModuleInfo: vi.fn().mockResolvedValue({
        sections: [],
        imports: [],
        exports: [],
      }),
      listFunctions: vi.fn().mockResolvedValue({
        functions,
      }),
      getFunctionGraphByVa: vi.fn().mockResolvedValue({
        functionStartVa: functions[0]?.start ?? "0x140001000",
        functionName: functions[0]?.name ?? "sub_140001000",
        focusBlockId: "b_1000",
        blocks: [],
        edges: [],
      }),
      disassembleLinear: vi.fn().mockResolvedValue({
        instructions: [],
        stopReason: "end_of_data",
      }),
      getLinearViewInfo: vi.fn().mockResolvedValue({
        rowCount: 1024,
        minVa: "0x0",
        maxVa: "0x4000",
        rowHeight: 24,
        dataGroupSize: 16,
      }),
      getLinearRows: vi.fn().mockResolvedValue({
        rows: [],
      }),
      findLinearRowByVa: vi.fn().mockResolvedValue({
        rowIndex: 0,
      }),
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

    const functionList = screen.getByTestId("function-list");
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

    fireEvent.pointerDown(screen.getByTestId("browser-panel"));
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

    const functionList = screen.getByTestId("function-list");
    expect(functionList).toHaveAttribute(
      "style",
      `height: ${expectedCanvasHeight}px;`,
    );
  });
});
