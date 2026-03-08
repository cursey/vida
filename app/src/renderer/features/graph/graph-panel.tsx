import {
  AppPanel,
  AppPanelBody,
  AppPanelHeader,
  AppPanelMeta,
  AppPanelTitle,
} from "@/shell/components/panel";
import cytoscape from "cytoscape";
// @ts-expect-error - library does not ship TypeScript declarations.
import cytoscapeNodeHtmlLabel from "cytoscape-node-html-label";
import { useEffect, useMemo, useRef } from "react";
import type { FunctionGraphInstruction, MethodResult } from "../../../shared";

type FunctionGraph = MethodResult["function.getGraphByVa"];

type GraphPanelProps = {
  isActive: boolean;
  moduleId: string;
  graph: FunctionGraph | null;
  onActivate: () => void;
};

type GraphNodeData = {
  id: string;
  startVa: string;
  width: number;
  height: number;
  instructions: FunctionGraphInstruction[];
};

type CytoscapeHtmlLabelCore = cytoscape.Core & {
  nodeHtmlLabel?: (...args: unknown[]) => void;
};

const NODE_MIN_WIDTH = 220;
const NODE_MAX_WIDTH = 560;
const NODE_CHAR_WIDTH = 7;
const NODE_PADDING_X = 24;
const NODE_LINE_HEIGHT = 14;
const NODE_LINE_SPACING = 2;
const NODE_PADDING_Y = 20;

let isNodeHtmlLabelRegistered = false;

function ensureNodeHtmlLabelRegistered() {
  if (isNodeHtmlLabelRegistered) {
    return;
  }
  cytoscapeNodeHtmlLabel(cytoscape);
  isNodeHtmlLabelRegistered = true;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildInstructionText(instruction: FunctionGraphInstruction): string {
  return instruction.operands
    ? `${instruction.mnemonic} ${instruction.operands}`
    : instruction.mnemonic;
}

function estimateNodeSize(block: {
  startVa: string;
  instructions: FunctionGraphInstruction[];
}): {
  width: number;
  height: number;
} {
  const longestChars = Math.max(
    block.startVa.length,
    ...block.instructions.map(
      (instruction) => buildInstructionText(instruction).length,
    ),
  );
  const width = Math.min(
    NODE_MAX_WIDTH,
    Math.max(NODE_MIN_WIDTH, longestChars * NODE_CHAR_WIDTH + NODE_PADDING_X),
  );
  const lineCount = 1 + block.instructions.length;
  const height =
    lineCount * NODE_LINE_HEIGHT +
    Math.max(0, lineCount - 1) * NODE_LINE_SPACING +
    NODE_PADDING_Y;
  return { width, height };
}

export function renderGraphNodeHtml(data: GraphNodeData): string {
  const instructionLines = data.instructions
    .map((instruction) => {
      const mnemonic = escapeHtml(instruction.mnemonic);
      const operands = escapeHtml(instruction.operands);
      return `<div class="graph-node-line"><span class="mnemonic mnemonic-${instruction.instructionCategory}">${mnemonic}</span>${operands ? `<span class="operands">${operands}</span>` : ""}</div>`;
    })
    .join("");

  return `<div class="graph-node-html"><div class="graph-node-header">${escapeHtml(data.startVa)}</div>${instructionLines}</div>`;
}

export function GraphPanel({
  isActive,
  moduleId,
  graph,
  onActivate,
}: GraphPanelProps) {
  const graphRef = useRef<HTMLDivElement | null>(null);

  const elements = useMemo(() => {
    if (!graph) {
      return [];
    }

    const nodes = graph.blocks.map((block) => {
      const size = estimateNodeSize(block);
      return {
        group: "nodes" as const,
        data: {
          id: block.id,
          startVa: block.startVa,
          width: size.width,
          height: size.height,
          instructions: block.instructions,
        },
      };
    });

    const edges = graph.edges.map((edge, index) => ({
      group: "edges" as const,
      data: {
        id: `${edge.fromBlockId}-${edge.toBlockId}-${index}`,
        source: edge.fromBlockId,
        target: edge.toBlockId,
        kind: edge.kind,
      },
    }));

    return [...nodes, ...edges];
  }, [graph]);

  const rootIds = useMemo(() => {
    if (!graph || graph.blocks.length === 0) {
      return [];
    }
    const roots = graph.blocks
      .filter((block) => block.startVa === graph.functionStartVa)
      .map((block) => block.id);
    if (roots.length > 0) {
      return roots;
    }
    const fallbackRoot = graph.blocks[0];
    return fallbackRoot ? [fallbackRoot.id] : [];
  }, [graph]);

  useEffect(() => {
    const container = graphRef.current;
    if (!container || !graph) {
      return;
    }

    ensureNodeHtmlLabelRegistered();

    const isDark = document.documentElement.classList.contains("dark");
    const borderColor = isDark ? "#374151" : "#cbd5e1";
    const mutedTextColor = isDark ? "#9ca3af" : "#334155";

    const cy = cytoscape({
      container,
      elements,
      layout: {
        name: "breadthfirst",
        directed: true,
        roots: rootIds,
        circle: false,
        grid: false,
        avoidOverlap: true,
        fit: false,
        padding: 28,
        spacingFactor: 1.35,
        animate: false,
      },
      style: [
        {
          selector: "node",
          style: {
            width: "data(width)",
            height: "data(height)",
            label: "",
            "background-opacity": 0,
            "border-width": 0,
          },
        },
        {
          selector: "edge",
          style: {
            width: "1.5px",
            "line-color": borderColor,
            "target-arrow-color": borderColor,
            "target-arrow-shape": "triangle",
            "curve-style": "taxi",
            "taxi-direction": "downward",
            "taxi-turn": 18,
          },
        },
        {
          selector: 'edge[kind = "conditional"]',
          style: {
            "line-color": mutedTextColor,
            "target-arrow-color": mutedTextColor,
          },
        },
        {
          selector: 'edge[kind = "fallthrough"]',
          style: {
            "line-style": "dashed",
          },
        },
      ],
      minZoom: 0.2,
      maxZoom: 2.5,
    });

    const cyWithHtml = cy as CytoscapeHtmlLabelCore;
    cyWithHtml.nodeHtmlLabel?.(
      [
        {
          query: "node",
          halign: "center",
          valign: "center",
          halignBox: "center",
          valignBox: "center",
          tpl: (data: GraphNodeData) => renderGraphNodeHtml(data),
        },
      ],
      {
        enablePointerEvents: false,
      },
    );

    cy.zoom(1);
    const focusNode = cy.getElementById(graph.focusBlockId);
    if (focusNode.nonempty()) {
      cy.center(focusNode);
    } else {
      cy.center();
    }

    return () => {
      cy.destroy();
    };
  }, [elements, graph, rootIds]);

  return (
    <AppPanel
      className="col-[3]"
      isActive={isActive}
      onPointerDown={onActivate}
      onWheel={onActivate}
      onFocusCapture={onActivate}
    >
      <AppPanelHeader>
        <AppPanelTitle>Graph View</AppPanelTitle>
        <AppPanelMeta>
          {moduleId && graph
            ? `${graph.functionName} @ ${graph.functionStartVa}`
            : ""}
        </AppPanelMeta>
      </AppPanelHeader>
      <AppPanelBody className="relative overflow-hidden p-0">
        {graph ? (
          <div className="h-full min-h-0 w-full" ref={graphRef} />
        ) : (
          <div className="flex h-full select-none items-center justify-center text-xs text-muted-foreground">
            No graph loaded.
          </div>
        )}
      </AppPanelBody>
    </AppPanel>
  );
}
