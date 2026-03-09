import { App } from "@/App";
import { createMockDesktopApi } from "@/test-utils/mock-desktop-api";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, LinearRow } from "../../shared";

vi.mock("@/components/mode-toggle", () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
}));

let mockDesktopApi: DesktopApi;

vi.mock("@/platform/desktop-api", () => ({
  get desktopApi() {
    return mockDesktopApi;
  },
}));

function buildRows(): LinearRow[] {
  return [
    {
      kind: "instruction",
      address: "0x140001000",
      bytes: "eb 1e",
      mnemonic: "jmp",
      operands: "lbl_140001020",
      instructionCategory: "control_flow",
      branchTarget: "0x140001020",
    },
    {
      kind: "instruction",
      address: "0x140001020",
      bytes: "c3",
      mnemonic: "ret",
      operands: "",
      instructionCategory: "return",
    },
    {
      kind: "instruction",
      address: "0x140002000",
      bytes: "c3",
      mnemonic: "ret",
      operands: "",
      instructionCategory: "return",
    },
  ];
}

function buildMemoryOverview() {
  return {
    startVa: "0x140001000",
    endVa: "0x140003000",
    slices: ["explored", "explored", "unexplored", "unmapped"] as const,
  };
}

describe("App graph view", () => {
  let menuOpenHandler: (() => void) | null = null;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  function installMockApi(
    getFunctionGraphByVa: DesktopApi["getFunctionGraphByVa"],
  ): DesktopApi {
    const rows = buildRows();
    const rowIndexByVa = new Map(
      rows.map((row, index) => [row.address, index] as const),
    );

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
            endVa: "0x140003000",
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
      getModuleMemoryOverview: vi.fn().mockResolvedValue(buildMemoryOverview()),
      getFunctionGraphByVa,
      getLinearViewInfo: vi.fn().mockResolvedValue({
        rowCount: rows.length,
        minVa: "0x140001000",
        maxVa: "0x140002000",
        rowHeight: 24,
        dataGroupSize: 16,
      }),
      getLinearRows: vi.fn().mockResolvedValue({
        rows,
      }),
      findLinearRowByVa: vi.fn().mockImplementation(async ({ va }) => ({
        rowIndex: rowIndexByVa.get(va) ?? 0,
      })),
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
          endVa: "0x140001003",
          isEntry: true,
          isExit: true,
          instructions: [
            {
              address: "0x140001000",
              mnemonic: "push",
              operands: "rbp",
              instructionCategory: "stack",
            },
            {
              address: "0x140001001",
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

  it("navigates back to disassembly when an instruction is activated from graph view", async () => {
    const graph = {
      functionStartVa: "0x140001000",
      functionName: "sub_140001000",
      focusBlockId: "b_1000",
      blocks: [
        {
          id: "b_1000",
          startVa: "0x140001000",
          endVa: "0x140001003",
          isEntry: true,
          isExit: true,
          instructions: [
            {
              address: "0x140001000",
              mnemonic: "push",
              operands: "rbp",
              instructionCategory: "stack" as const,
            },
          ],
        },
      ],
      edges: [],
    };
    const getFunctionGraphByVa = vi.fn().mockResolvedValue(graph);
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

    const graphCanvas = await screen.findByTestId("graph-canvas");
    fireEvent.keyDown(graphCanvas, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Disassembly")).toBeInTheDocument();
      expect(screen.queryByText("Graph View")).not.toBeInTheDocument();
    });
  });

  it("focuses the target basic block when a branch operand is clicked in graph view", async () => {
    const getFunctionGraphByVa = vi.fn().mockImplementation(async ({ va }) => {
      if (va === "0x140001000") {
        return {
          functionStartVa: "0x140001000",
          functionName: "sub_140001000",
          focusBlockId: "b_1000",
          blocks: [
            {
              id: "b_1000",
              startVa: "0x140001000",
              endVa: "0x140001003",
              isEntry: true,
              isExit: false,
              instructions: [
                {
                  address: "0x140001000",
                  mnemonic: "jmp",
                  operands: "lbl_140001020",
                  instructionCategory: "control_flow" as const,
                  branchTarget: "0x140001020",
                },
              ],
            },
            {
              id: "b_1020",
              startVa: "0x140001020",
              endVa: "0x140001021",
              isEntry: false,
              isExit: true,
              instructions: [
                {
                  address: "0x140001020",
                  mnemonic: "ret",
                  operands: "",
                  instructionCategory: "return" as const,
                },
              ],
            },
          ],
          edges: [
            {
              id: "e_1000_1020",
              fromBlockId: "b_1000",
              toBlockId: "b_1020",
              kind: "unconditional" as const,
              sourceInstructionVa: "0x140001000",
              isBackEdge: false,
            },
          ],
        };
      }

      return {
        functionStartVa: "0x140001000",
        functionName: "sub_140001000",
        focusBlockId: "b_1020",
        blocks: [
          {
            id: "b_1000",
            startVa: "0x140001000",
            endVa: "0x140001003",
            isEntry: true,
            isExit: false,
            instructions: [
              {
                address: "0x140001000",
                mnemonic: "jmp",
                operands: "lbl_140001020",
                instructionCategory: "control_flow" as const,
                branchTarget: "0x140001020",
              },
            ],
          },
          {
            id: "b_1020",
            startVa: "0x140001020",
            endVa: "0x140001021",
            isEntry: false,
            isExit: true,
            instructions: [
              {
                address: "0x140001020",
                mnemonic: "ret",
                operands: "",
                instructionCategory: "return" as const,
              },
            ],
          },
        ],
        edges: [
          {
            id: "e_1000_1020",
            fromBlockId: "b_1000",
            toBlockId: "b_1020",
            kind: "unconditional" as const,
            sourceInstructionVa: "0x140001000",
            isBackEdge: false,
          },
        ],
      };
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

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Follow graph operand lbl_140001020 to 0x140001020",
      }),
    );

    await waitFor(() => {
      expect(getFunctionGraphByVa).toHaveBeenNthCalledWith(2, {
        moduleId: "m1",
        va: "0x140001020",
      });
      expect(screen.getByText("Graph View")).toBeInTheDocument();
      expect(screen.getByText("0x140001020 | 0x140001020")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        Number(
          screen.getByTestId("memory-overview-viewport").getAttribute("x1"),
        ),
      ).toBeCloseTo(3.90625, 3);
    });

    fireEvent.keyDown(window, { key: " ", code: "Space" });

    await waitFor(() => {
      expect(screen.getByText("Disassembly")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "g", code: "KeyG" });

    await waitFor(() => {
      expect(screen.getByText("Go To Address")).toBeInTheDocument();
      expect(screen.getByDisplayValue("0x140001020")).toBeInTheDocument();
    });
  });

  it("switches graph view to another function when a call operand is clicked", async () => {
    const getFunctionGraphByVa = vi.fn().mockImplementation(async ({ va }) => {
      if (va === "0x140001000") {
        return {
          functionStartVa: "0x140001000",
          functionName: "sub_140001000",
          focusBlockId: "b_1000",
          blocks: [
            {
              id: "b_1000",
              startVa: "0x140001000",
              endVa: "0x140001005",
              isEntry: true,
              isExit: true,
              instructions: [
                {
                  address: "0x140001000",
                  mnemonic: "call",
                  operands: "sub_140002000",
                  instructionCategory: "call" as const,
                  callTarget: "0x140002000",
                },
              ],
            },
          ],
          edges: [],
        };
      }

      return {
        functionStartVa: "0x140002000",
        functionName: "sub_140002000",
        focusBlockId: "b_2000",
        blocks: [
          {
            id: "b_2000",
            startVa: "0x140002000",
            endVa: "0x140002001",
            isEntry: true,
            isExit: true,
            instructions: [
              {
                address: "0x140002000",
                mnemonic: "ret",
                operands: "",
                instructionCategory: "return" as const,
              },
            ],
          },
        ],
        edges: [],
      };
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

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Follow graph operand sub_140002000 to 0x140002000",
      }),
    );

    await waitFor(() => {
      expect(getFunctionGraphByVa).toHaveBeenNthCalledWith(2, {
        moduleId: "m1",
        va: "0x140002000",
      });
      expect(
        screen.getByText("sub_140002000 @ 0x140002000"),
      ).toBeInTheDocument();
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
