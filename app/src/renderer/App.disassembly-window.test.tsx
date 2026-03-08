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
import type { DesktopApi, LinearRow, MethodResult } from "../shared/protocol";

vi.mock("@/components/mode-toggle", () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
}));

let mockDesktopApi: DesktopApi;

vi.mock("@/desktop-api", () => ({
  get desktopApi() {
    return mockDesktopApi;
  },
}));

const HUGE_ROW_COUNT = 5_570_947;
const ROW_HEIGHT = 24;
const EXPECTED_WINDOW_HEIGHT = 100_000 * ROW_HEIGHT;

function buildMemoryOverview(): MethodResult["module.getMemoryOverview"] {
  return {
    startVa: "0x140000000",
    endVa: "0x160000000",
    slices: ["ro", "explored", "unexplored", "unmapped"],
  };
}

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
  let findLinearRowByVaMock: ReturnType<typeof vi.fn>;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    menuOpenHandler = null;
    findLinearRowByVaMock = vi.fn().mockResolvedValue({ rowIndex: 0 });
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

    mockDesktopApi = createMockDesktopApi({
      pickExecutable: vi.fn().mockResolvedValue("C:\\fixtures\\huge.exe"),
      onMenuOpenExecutable: vi.fn((callback: () => void) => {
        menuOpenHandler = callback;
        return () => {};
      }),
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
      getModuleMemoryOverview: vi.fn().mockResolvedValue(buildMemoryOverview()),
      listFunctions: vi.fn().mockResolvedValue({
        functions: [{ start: "0x140001000", name: "entry", kind: "entry" }],
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
      findLinearRowByVa:
        findLinearRowByVaMock as DesktopApi["findLinearRowByVa"],
    });
  });

  afterEach(() => {
    rectSpy.mockRestore();
  });

  it("keeps the disassembly canvas bounded for very large row counts", async () => {
    const { container } = render(<App />);

    expect(screen.queryByTestId("memory-overview-empty-bar")).toBeNull();
    expect(screen.queryByTestId("memory-overview-empty")).toBeNull();

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(container.textContent).toContain(`${HUGE_ROW_COUNT} rows`);
    });

    const canvas = screen.getByTestId("disassembly-canvas");
    expect(canvas).toHaveAttribute(
      "style",
      `height: ${EXPECTED_WINDOW_HEIGHT}px;`,
    );
    expect(HUGE_ROW_COUNT * ROW_HEIGHT).toBeGreaterThan(EXPECTED_WINDOW_HEIGHT);

    await waitFor(() => {
      expect(screen.queryByTestId("memory-overview-empty")).toBeNull();
      expect(screen.getByTestId("memory-slice-explored")).toBeInTheDocument();
      expect(screen.getByTestId("memory-slice-ro")).toBeInTheDocument();
      expect(screen.getByTestId("memory-slice-unmapped")).toBeInTheDocument();
    });

    const overviewBar = screen.getByTestId("memory-overview-button");

    const initialLookupCount = findLinearRowByVaMock.mock.calls.length;
    fireEvent.click(overviewBar, { clientX: 480, clientY: 14 });

    await waitFor(() => {
      expect(findLinearRowByVaMock).toHaveBeenCalledTimes(
        initialLookupCount + 1,
      );
    });
    expect(findLinearRowByVaMock.mock.lastCall?.[0]).toEqual({
      moduleId: "huge-module",
      va: "0x150000000",
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("memory-overview-viewport"),
      ).toBeInTheDocument();
    });
  });

  it("shows analysis panes once ready even if memory overview is still loading", async () => {
    let resolveReadyOverview:
      | ((value: ReturnType<typeof buildMemoryOverview>) => void)
      | null = null;
    const readyOverviewPromise = new Promise<
      ReturnType<typeof buildMemoryOverview>
    >((resolve) => {
      resolveReadyOverview = resolve;
    });

    mockDesktopApi = createMockDesktopApi({
      pickExecutable: vi.fn().mockResolvedValue("C:\\fixtures\\huge.exe"),
      onMenuOpenExecutable: vi.fn((callback: () => void) => {
        menuOpenHandler = callback;
        return () => {};
      }),
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
      getModuleMemoryOverview: vi
        .fn()
        .mockImplementationOnce(async () => readyOverviewPromise),
      listFunctions: vi.fn().mockResolvedValue({
        functions: [{ start: "0x140001000", name: "entry", kind: "entry" }],
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
      findLinearRowByVa:
        findLinearRowByVaMock as DesktopApi["findLinearRowByVa"],
    });

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

    expect(mockDesktopApi.getModuleMemoryOverview).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("memory-overview-empty")).toBeInTheDocument();

    await act(async () => {
      resolveReadyOverview?.(buildMemoryOverview());
      await readyOverviewPromise;
    });

    await waitFor(() => {
      expect(screen.queryByTestId("memory-overview-empty")).toBeNull();
    });
  });

  it("keeps the browser and analysis panes hidden until analysis is ready", async () => {
    let resolveStatus:
      | ((value: MethodResult["module.getAnalysisStatus"]) => void)
      | null = null;
    const pendingStatus = new Promise<MethodResult["module.getAnalysisStatus"]>(
      (resolve) => {
        resolveStatus = resolve;
      },
    );
    const listFunctionsMock = vi.fn().mockResolvedValue({
      functions: [{ start: "0x140001000", name: "entry", kind: "entry" }],
    });
    const getModuleMemoryOverviewMock = vi
      .fn()
      .mockResolvedValue(buildMemoryOverview());

    mockDesktopApi = createMockDesktopApi({
      pickExecutable: vi.fn().mockResolvedValue("C:\\fixtures\\huge.exe"),
      onMenuOpenExecutable: vi.fn((callback: () => void) => {
        menuOpenHandler = callback;
        return () => {};
      }),
      openModule: vi.fn().mockResolvedValue({
        moduleId: "huge-module",
        arch: "x64",
        imageBase: "0x140000000",
        entryVa: "0x140001000",
      }),
      getModuleAnalysisStatus: vi
        .fn()
        .mockImplementationOnce(async () => pendingStatus),
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
      getModuleMemoryOverview:
        getModuleMemoryOverviewMock as DesktopApi["getModuleMemoryOverview"],
      listFunctions: listFunctionsMock as DesktopApi["listFunctions"],
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
      findLinearRowByVa:
        findLinearRowByVaMock as DesktopApi["findLinearRowByVa"],
    });

    const { container } = render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(mockDesktopApi.getModuleAnalysisStatus).toHaveBeenCalledTimes(1);
    });

    expect(listFunctionsMock).not.toHaveBeenCalled();
    expect(getModuleMemoryOverviewMock).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId("function-row")).toHaveLength(0);
    expect(screen.queryByTestId("memory-overview")).toBeNull();
    expect(screen.queryByTestId("browser-panel")).toBeNull();
    expect(screen.queryByTestId("disassembly-canvas")).toBeNull();

    await act(async () => {
      resolveStatus?.({
        state: "ready",
        message: "Analysis ready.",
        discoveredFunctionCount: 1,
        totalFunctionCount: 1,
        analyzedFunctionCount: 1,
      });
      await pendingStatus;
    });

    await waitFor(() => {
      expect(container.textContent).toContain(`${HUGE_ROW_COUNT} rows`);
      expect(listFunctionsMock).toHaveBeenCalledTimes(1);
      expect(getModuleMemoryOverviewMock).toHaveBeenCalledTimes(1);
    });
  });
});
