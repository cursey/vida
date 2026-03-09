import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MethodResult } from "../../../shared";
import {
  GraphPanel,
  buildGraphScene,
  centerViewportOnBlock,
  findGraphHit,
  screenPointForScenePoint,
} from "./graph-panel";

type FunctionGraph = MethodResult["function.getGraphByVa"];

function buildDiamondGraph(): FunctionGraph {
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
        isExit: false,
        instructions: [
          {
            address: "0x140001000",
            mnemonic: "cmp",
            operands: "eax, 1",
            instructionCategory: "compare_test",
          },
        ],
      },
      {
        id: "b_1010",
        startVa: "0x140001010",
        endVa: "0x140001014",
        isEntry: false,
        isExit: false,
        instructions: [
          {
            address: "0x140001010",
            mnemonic: "mov",
            operands: "ecx, eax",
            instructionCategory: "data_transfer",
          },
        ],
      },
      {
        id: "b_1020",
        startVa: "0x140001020",
        endVa: "0x140001024",
        isEntry: false,
        isExit: false,
        instructions: [
          {
            address: "0x140001020",
            mnemonic: "add",
            operands: "eax, 2",
            instructionCategory: "arithmetic",
          },
        ],
      },
      {
        id: "b_1030",
        startVa: "0x140001030",
        endVa: "0x140001031",
        isEntry: false,
        isExit: true,
        instructions: [
          {
            address: "0x140001030",
            mnemonic: "ret",
            operands: "",
            instructionCategory: "return",
          },
        ],
      },
    ],
    edges: [
      {
        id: "e_entry_true",
        fromBlockId: "b_1000",
        toBlockId: "b_1010",
        kind: "conditional",
        sourceInstructionVa: "0x140001000",
        isBackEdge: false,
      },
      {
        id: "e_entry_false",
        fromBlockId: "b_1000",
        toBlockId: "b_1020",
        kind: "fallthrough",
        sourceInstructionVa: "0x140001000",
        isBackEdge: false,
      },
      {
        id: "e_left_exit",
        fromBlockId: "b_1010",
        toBlockId: "b_1030",
        kind: "unconditional",
        sourceInstructionVa: "0x140001010",
        isBackEdge: false,
      },
      {
        id: "e_right_exit",
        fromBlockId: "b_1020",
        toBlockId: "b_1030",
        kind: "unconditional",
        sourceInstructionVa: "0x140001020",
        isBackEdge: false,
      },
    ],
  };
}

function buildLoopGraph(): FunctionGraph {
  return {
    functionStartVa: "0x140002000",
    functionName: "sub_140002000",
    focusBlockId: "b_2000",
    blocks: [
      {
        id: "b_2000",
        startVa: "0x140002000",
        endVa: "0x140002003",
        isEntry: true,
        isExit: false,
        instructions: [
          {
            address: "0x140002000",
            mnemonic: "jmp",
            operands: "lbl_140002010",
            instructionCategory: "control_flow",
            branchTarget: "0x140002010",
          },
        ],
      },
      {
        id: "b_2010",
        startVa: "0x140002010",
        endVa: "0x140002014",
        isEntry: false,
        isExit: false,
        instructions: [
          {
            address: "0x140002010",
            mnemonic: "inc",
            operands: "ecx",
            instructionCategory: "arithmetic",
          },
        ],
      },
      {
        id: "b_2020",
        startVa: "0x140002020",
        endVa: "0x140002024",
        isEntry: false,
        isExit: false,
        instructions: [
          {
            address: "0x140002020",
            mnemonic: "jne",
            operands: "lbl_140002010",
            instructionCategory: "control_flow",
            branchTarget: "0x140002010",
          },
        ],
      },
      {
        id: "b_2030",
        startVa: "0x140002030",
        endVa: "0x140002031",
        isEntry: false,
        isExit: true,
        instructions: [
          {
            address: "0x140002030",
            mnemonic: "ret",
            operands: "",
            instructionCategory: "return",
          },
        ],
      },
    ],
    edges: [
      {
        id: "e_entry",
        fromBlockId: "b_2000",
        toBlockId: "b_2010",
        kind: "unconditional",
        sourceInstructionVa: "0x140002000",
        isBackEdge: false,
      },
      {
        id: "e_to_loop_test",
        fromBlockId: "b_2010",
        toBlockId: "b_2020",
        kind: "fallthrough",
        sourceInstructionVa: "0x140002010",
        isBackEdge: false,
      },
      {
        id: "e_back",
        fromBlockId: "b_2020",
        toBlockId: "b_2010",
        kind: "conditional",
        sourceInstructionVa: "0x140002020",
        isBackEdge: true,
      },
      {
        id: "e_exit",
        fromBlockId: "b_2020",
        toBlockId: "b_2030",
        kind: "fallthrough",
        sourceInstructionVa: "0x140002020",
        isBackEdge: false,
      },
    ],
  };
}

describe("graph layout", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({
        x: 0,
        y: 0,
        width: 960,
        height: 640,
        top: 0,
        left: 0,
        right: 960,
        bottom: 640,
        toJSON: () => ({}),
      }),
    );
  });

  it("assigns stable ranks and hit-tests instruction rows", () => {
    const scene = buildGraphScene(buildDiamondGraph());
    const entry = scene.blocks.find((block) => block.id === "b_1000");
    const left = scene.blocks.find((block) => block.id === "b_1010");
    const right = scene.blocks.find((block) => block.id === "b_1020");
    const exit = scene.blocks.find((block) => block.id === "b_1030");

    expect(entry?.rank).toBe(0);
    expect(left?.rank).toBe(1);
    expect(right?.rank).toBe(1);
    expect(exit?.rank).toBe(2);

    const row = entry?.rowRects[0];
    expect(row).toBeDefined();
    const hit = findGraphHit(scene, {
      x: (row?.rect.x ?? 0) + 24,
      y: (row?.rect.y ?? 0) + 8,
    });
    expect(hit).toEqual({
      type: "instruction",
      address: "0x140001000",
      blockId: "b_1000",
    });
  });

  it("routes back edges through an outer gutter", () => {
    const scene = buildGraphScene(buildLoopGraph());
    const backEdge = scene.edges.find((edge) => edge.id === "e_back");
    const fromBlock = scene.blocks.find((block) => block.id === "b_2020");
    const toBlock = scene.blocks.find((block) => block.id === "b_2010");
    const minBlockX = Math.min(fromBlock?.rect.x ?? 0, toBlock?.rect.x ?? 0);
    const maxBlockX = Math.max(
      (fromBlock?.rect.x ?? 0) + (fromBlock?.rect.width ?? 0),
      (toBlock?.rect.x ?? 0) + (toBlock?.rect.width ?? 0),
    );

    expect(backEdge?.isBackEdge).toBe(true);
    expect(
      backEdge?.points.some(
        (point) => point.x < minBlockX || point.x > maxBlockX,
      ),
    ).toBe(true);
  });
});

describe("GraphPanel", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({
        x: 0,
        y: 0,
        width: 960,
        height: 640,
        top: 0,
        left: 0,
        right: 960,
        bottom: 640,
        toJSON: () => ({}),
      }),
    );
  });

  it("selects and navigates to instruction rows through canvas hit testing", () => {
    const graph = buildDiamondGraph();
    const onSelectInstruction = vi.fn();
    const onNavigateToInstruction = vi.fn().mockResolvedValue(true);

    render(
      <div style={{ height: 640, width: 960 }}>
        <GraphPanel
          graph={graph}
          isActive
          moduleId="m1"
          onActivate={() => {}}
          onNavigateToInstruction={onNavigateToInstruction}
          onSelectInstruction={onSelectInstruction}
          selectedVa="0x140001000"
        />
      </div>,
    );

    const canvas = screen.getByTestId("graph-canvas");
    const scene = buildGraphScene(graph);
    const viewport = centerViewportOnBlock(scene, graph.focusBlockId, {
      width: 960,
      height: 640,
    });
    const entryBlock = scene.blocks.find((block) => block.id === "b_1000");
    const row = entryBlock?.rowRects[0];
    const screenPoint = screenPointForScenePoint(viewport, {
      x: (row?.rect.x ?? 0) + 24,
      y: (row?.rect.y ?? 0) + 9,
    });

    fireEvent.pointerDown(canvas, {
      button: 0,
      clientX: screenPoint.x,
      clientY: screenPoint.y,
      pointerId: 1,
    });

    expect(onSelectInstruction).toHaveBeenCalledWith("0x140001000");

    fireEvent.doubleClick(canvas, {
      clientX: screenPoint.x,
      clientY: screenPoint.y,
    });

    expect(onNavigateToInstruction).toHaveBeenCalledWith("0x140001000");
  });
});
