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
import type { DesktopApi, LinearRow } from "../shared/protocol";

vi.mock("@/components/mode-toggle", () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
}));

vi.mock("cytoscape", () => ({
  default: vi.fn(() => ({
    getElementById: vi.fn(() => ({
      nonempty: () => true,
    })),
    zoom: vi.fn(),
    center: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock("cytoscape-node-html-label", () => ({
  default: vi.fn(),
}));

let mockDesktopApi: DesktopApi;

vi.mock("@/desktop-api", () => ({
  get desktopApi() {
    return mockDesktopApi;
  },
}));

function buildRows(): LinearRow[] {
  return [
    {
      kind: "instruction",
      address: "0x140001000",
      bytes: "55",
      mnemonic: "push",
      operands: "rbp",
      instructionCategory: "stack",
    },
  ];
}

describe("App graph view", () => {
  let menuOpenHandler: (() => void) | null = null;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  function installMockApi(
    getFunctionGraphByVa: DesktopApi["getFunctionGraphByVa"],
  ): DesktopApi {
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
        entryVa: "0x140001000",
      }),
      getModuleInfo: vi.fn().mockResolvedValue({
        sections: [
          {
            name: ".text",
            startVa: "0x140001000",
            endVa: "0x140002000",
            rawOffset: 0,
            rawSize: 0,
          },
        ],
        imports: [],
        exports: [],
      }),
      listFunctions: vi.fn().mockResolvedValue({
        functions: [
          {
            start: "0x140001000",
            name: "sub_140001000",
            kind: "entry",
          },
        ],
      }),
      getFunctionGraphByVa,
      getLinearViewInfo: vi.fn().mockResolvedValue({
        rowCount: 1,
        minVa: "0x140001000",
        maxVa: "0x140001000",
        rowHeight: 24,
        dataGroupSize: 16,
      }),
      getLinearRows: vi.fn().mockResolvedValue({
        rows: buildRows(),
      }),
      findLinearRowByVa: vi.fn().mockResolvedValue({
        rowIndex: 0,
      }),
    });

    return mockDesktopApi;
  }

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
  });

  afterEach(() => {
    rectSpy.mockRestore();
  });

  it("toggles between disassembly and graph view on space for function instructions", async () => {
    const getFunctionGraphByVa = vi.fn().mockResolvedValue({
      functionStartVa: "0x140001000",
      functionName: "sub_140001000",
      focusBlockId: "b_1000",
      blocks: [
        {
          id: "b_1000",
          startVa: "0x140001000",
          instructions: [
            {
              mnemonic: "push",
              operands: "rbp",
              instructionCategory: "stack",
            },
            {
              mnemonic: "mov",
              operands: "rbp,rsp",
              instructionCategory: "data_transfer",
            },
          ],
        },
      ],
      edges: [],
    });
    installMockApi(getFunctionGraphByVa);

    render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(screen.getByText("Disassembly")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: " ", code: "Space" });

    await waitFor(() => {
      expect(screen.getByText("Graph View")).toBeInTheDocument();
      expect(getFunctionGraphByVa).toHaveBeenCalledWith({
        moduleId: "m1",
        va: "0x140001000",
      });
    });

    fireEvent.keyDown(window, { key: " ", code: "Space" });

    await waitFor(() => {
      expect(screen.getByText("Disassembly")).toBeInTheDocument();
      expect(screen.queryByText("Graph View")).not.toBeInTheDocument();
    });
  });

  it("shows a status message and stays in disassembly when the highlighted instruction is not in a discovered function", async () => {
    const getFunctionGraphByVa = vi
      .fn()
      .mockRejectedValue(new Error("Invalid address (INVALID_ADDRESS)"));
    installMockApi(getFunctionGraphByVa);

    render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(screen.getByText("Disassembly")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: " ", code: "Space" });

    await waitFor(() => {
      expect(
        screen.getByText(
          "The highlighted instruction does not belong to a discovered function.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Disassembly")).toBeInTheDocument();
      expect(screen.queryByText("Graph View")).not.toBeInTheDocument();
    });
  });
});
