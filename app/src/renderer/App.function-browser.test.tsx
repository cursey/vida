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

const FUNCTION_COUNT = 2000;

function buildFunctions(count: number): FunctionSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    start: `0x${(0x1000 + index * 0x10).toString(16)}`,
    name: `sub_${(0x1000 + index * 0x10).toString(16)}`,
    kind: "entry",
  }));
}

describe("App function browser virtualization", () => {
  let functions: FunctionSeed[] = [];
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

    functions = buildFunctions(FUNCTION_COUNT);
    mockDesktopApi = createMockDesktopApi({
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
      openModule: vi.fn().mockResolvedValue({
        moduleId: "m1",
        arch: "x64",
        imageBase: "0x140000000",
        entryVa: functions[0].start,
      }),
      unloadModule: vi.fn().mockResolvedValue({}),
      getModuleAnalysisStatus: vi.fn().mockResolvedValue({
        state: "ready",
        message: "Analysis ready.",
        discoveredFunctionCount: FUNCTION_COUNT,
        totalFunctionCount: FUNCTION_COUNT,
        analyzedFunctionCount: FUNCTION_COUNT,
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
        rowCount: 0,
        minVa: "0x0",
        maxVa: "0x0",
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
      expect(screen.getByTestId("function-list")).toHaveAttribute(
        "style",
        `height: ${FUNCTION_COUNT * 26}px;`,
      );
    });

    const renderedRowCount = container.querySelectorAll(
      '[data-testid="function-row"]',
    ).length;
    expect(renderedRowCount).toBeLessThan(FUNCTION_COUNT);

    await act(async () => {
      menuUnloadHandler?.();
    });

    await waitFor(() => {
      expect(container.textContent).not.toContain("0 functions");
      expect(container.textContent).not.toContain("No module");
    });
  });

  it("searches browser functions case-insensitively and updates the count", async () => {
    const { container } = render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });
    expect(screen.queryByLabelText("Search functions")).toBeNull();

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(container.textContent).toContain(`${FUNCTION_COUNT} functions`);
    });

    fireEvent.pointerDown(screen.getByTestId("browser-panel"));
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });

    const searchInput = await screen.findByLabelText("Search functions");
    expect(searchInput).toBeEnabled();
    expect(searchInput).toHaveAttribute("placeholder", "Search");

    const query = "SUB_10";
    const expectedCount = functions.filter((func) =>
      func.name.toLowerCase().includes(query.toLowerCase()),
    ).length;

    fireEvent.change(searchInput, { target: { value: query } });

    await waitFor(() => {
      expect(container.textContent).toContain(
        `${expectedCount}/${FUNCTION_COUNT} functions`,
      );
      expect(screen.getByTestId("function-list")).toHaveAttribute(
        "style",
        `height: ${expectedCount * 26}px;`,
      );
    });

    fireEvent.change(searchInput, { target: { value: "definitely_no_match" } });

    await waitFor(() => {
      expect(container.textContent).toContain(`0/${FUNCTION_COUNT} functions`);
      expect(screen.getByTestId("function-list")).toHaveAttribute(
        "style",
        "height: 0px;",
      );
    });

    fireEvent.change(searchInput, { target: { value: "" } });

    await waitFor(() => {
      expect(container.textContent).toContain(`${FUNCTION_COUNT} functions`);
      expect(screen.getByTestId("function-list")).toHaveAttribute(
        "style",
        `height: ${FUNCTION_COUNT * 26}px;`,
      );
    });

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await waitFor(() => {
      expect(screen.queryByLabelText("Search functions")).toBeNull();
      expect(container.textContent).toContain(`${FUNCTION_COUNT} functions`);
    });
  });
});
