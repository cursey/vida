import {
  AppPanel,
  AppPanelBody,
  AppPanelHeader,
  AppPanelMeta,
  AppPanelTitle,
} from "@/shell/components/panel";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MethodResult } from "../../../shared";
import {
  type GraphBlockScene,
  type GraphHit,
  type GraphPoint,
  type GraphScene,
  type GraphViewport,
  buildGraphScene,
  centerViewportOnBlock,
  findGraphHit,
  fitSceneViewport,
  graphPointFromClientPoint,
  screenPointForScenePoint,
  zoomViewportAtPoint,
} from "./graph-layout";

type FunctionGraph = MethodResult["function.getGraphByVa"];

type GraphPanelProps = {
  isActive: boolean;
  moduleId: string;
  graph: FunctionGraph | null;
  selectedVa: string;
  onActivate: () => void;
  onSelectInstruction: (va: string) => void;
  onNavigateToInstruction: (va: string) => Promise<boolean>;
};

type GraphTheme = {
  panelFill: string;
  headerFill: string;
  panelStroke: string;
  panelStrokeSoft: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  focusAccent: string;
  hoverFill: string;
  selectedFill: string;
  blockShadow: string;
  mnemonics: Record<string, string>;
};

const HEADER_FONT = '600 11px "Geist Mono", "JetBrains Mono", monospace';
const BODY_FONT = '11px "Geist Mono", "JetBrains Mono", monospace';
const BADGE_FONT = '600 10px "Geist Sans", "Inter", sans-serif';
const BLOCK_RADIUS = 12;
const EDGE_WIDTH = 1.6;
const FALLTHROUGH_DASH = [8, 6];

function readCssVar(
  styles: CSSStyleDeclaration,
  name: string,
  fallback: string,
): string {
  const value = styles.getPropertyValue(name).trim();
  return value || fallback;
}

function getGraphTheme(element: HTMLElement | null): GraphTheme {
  const styles = element ? window.getComputedStyle(element) : null;
  return {
    panelFill: readCssVar(
      styles ?? document.documentElement.style,
      "--bg-panel",
      "#16161b",
    ),
    headerFill: readCssVar(
      styles ?? document.documentElement.style,
      "--bg-panel-header",
      "#202028",
    ),
    panelStroke: readCssVar(
      styles ?? document.documentElement.style,
      "--line-strong",
      "#4b5563",
    ),
    panelStrokeSoft: readCssVar(
      styles ?? document.documentElement.style,
      "--line-soft",
      "#374151",
    ),
    textPrimary: readCssVar(
      styles ?? document.documentElement.style,
      "--text-primary",
      "#f5f5f5",
    ),
    textSecondary: readCssVar(
      styles ?? document.documentElement.style,
      "--text-secondary",
      "#cbd5e1",
    ),
    textMuted: readCssVar(
      styles ?? document.documentElement.style,
      "--text-muted",
      "#94a3b8",
    ),
    accent: readCssVar(
      styles ?? document.documentElement.style,
      "--memory-viewport",
      "#f59e0b",
    ),
    focusAccent: readCssVar(
      styles ?? document.documentElement.style,
      "--mnemonic-call",
      "#60a5fa",
    ),
    hoverFill: readCssVar(
      styles ?? document.documentElement.style,
      "--bg-panel-header",
      "#232a35",
    ),
    selectedFill: readCssVar(
      styles ?? document.documentElement.style,
      "--memory-viewport",
      "#f59e0b",
    ),
    blockShadow: "rgba(15, 23, 42, 0.18)",
    mnemonics: {
      call: readCssVar(
        styles ?? document.documentElement.style,
        "--mnemonic-call",
        "#60a5fa",
      ),
      return: readCssVar(
        styles ?? document.documentElement.style,
        "--mnemonic-return",
        "#fb923c",
      ),
      control_flow: readCssVar(
        styles ?? document.documentElement.style,
        "--mnemonic-control-flow",
        "#c084fc",
      ),
      system: readCssVar(
        styles ?? document.documentElement.style,
        "--mnemonic-system",
        "#f87171",
      ),
      stack: readCssVar(
        styles ?? document.documentElement.style,
        "--mnemonic-stack",
        "#34d399",
      ),
      string: readCssVar(
        styles ?? document.documentElement.style,
        "--mnemonic-string",
        "#4ade80",
      ),
      compare_test: readCssVar(
        styles ?? document.documentElement.style,
        "--mnemonic-compare-test",
        "#fbbf24",
      ),
      arithmetic: readCssVar(
        styles ?? document.documentElement.style,
        "--mnemonic-arithmetic",
        "#fb923c",
      ),
      logic: readCssVar(
        styles ?? document.documentElement.style,
        "--mnemonic-logic",
        "#22d3ee",
      ),
      bit_shift: readCssVar(
        styles ?? document.documentElement.style,
        "--mnemonic-bit-shift",
        "#c084fc",
      ),
      data_transfer: readCssVar(
        styles ?? document.documentElement.style,
        "--mnemonic-data-transfer",
        "#93c5fd",
      ),
      other: readCssVar(
        styles ?? document.documentElement.style,
        "--mnemonic-other",
        "#f5f5f5",
      ),
    },
  };
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  radius: number,
) {
  const clampedRadius = Math.min(radius, rect.width / 2, rect.height / 2);
  context.beginPath();
  context.moveTo(rect.x + clampedRadius, rect.y);
  context.lineTo(rect.x + rect.width - clampedRadius, rect.y);
  context.quadraticCurveTo(
    rect.x + rect.width,
    rect.y,
    rect.x + rect.width,
    rect.y + clampedRadius,
  );
  context.lineTo(rect.x + rect.width, rect.y + rect.height - clampedRadius);
  context.quadraticCurveTo(
    rect.x + rect.width,
    rect.y + rect.height,
    rect.x + rect.width - clampedRadius,
    rect.y + rect.height,
  );
  context.lineTo(rect.x + clampedRadius, rect.y + rect.height);
  context.quadraticCurveTo(
    rect.x,
    rect.y + rect.height,
    rect.x,
    rect.y + rect.height - clampedRadius,
  );
  context.lineTo(rect.x, rect.y + clampedRadius);
  context.quadraticCurveTo(rect.x, rect.y, rect.x + clampedRadius, rect.y);
  context.closePath();
}

function drawBadge(
  context: CanvasRenderingContext2D,
  theme: GraphTheme,
  label: string,
  x: number,
  y: number,
) {
  context.save();
  context.font = BADGE_FONT;
  const width = context.measureText(label).width + 12;
  context.fillStyle = theme.headerFill;
  context.globalAlpha = 0.95;
  drawRoundedRect(context, { x, y, width, height: 16 }, 8);
  context.fill();
  context.globalAlpha = 1;
  context.strokeStyle = theme.panelStrokeSoft;
  context.stroke();
  context.fillStyle = theme.textMuted;
  context.textBaseline = "middle";
  context.fillText(label, x + 6, y + 8.5);
  context.restore();
}

function drawArrowHead(
  context: CanvasRenderingContext2D,
  from: GraphPoint,
  to: GraphPoint,
  color: string,
) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 7;
  context.save();
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(
    to.x - Math.cos(angle - Math.PI / 6) * size,
    to.y - Math.sin(angle - Math.PI / 6) * size,
  );
  context.lineTo(
    to.x - Math.cos(angle + Math.PI / 6) * size,
    to.y - Math.sin(angle + Math.PI / 6) * size,
  );
  context.closePath();
  context.fill();
  context.restore();
}

function drawEdge(
  context: CanvasRenderingContext2D,
  theme: GraphTheme,
  edge: GraphScene["edges"][number],
) {
  const color =
    edge.kind === "conditional"
      ? theme.textMuted
      : edge.isBackEdge
        ? theme.focusAccent
        : theme.panelStroke;
  context.save();
  context.beginPath();
  context.lineWidth = EDGE_WIDTH;
  context.strokeStyle = color;
  context.globalAlpha = edge.isBackEdge ? 0.95 : 0.82;
  if (edge.kind === "fallthrough") {
    context.setLineDash(FALLTHROUGH_DASH);
  }
  context.moveTo(edge.points[0]?.x ?? 0, edge.points[0]?.y ?? 0);
  for (const point of edge.points.slice(1)) {
    context.lineTo(point.x, point.y);
  }
  context.stroke();
  context.setLineDash([]);
  context.globalAlpha = 1;
  if (edge.points.length >= 2) {
    const fromPoint = edge.points[edge.points.length - 2];
    const toPoint = edge.points[edge.points.length - 1];
    if (!fromPoint || !toPoint) {
      context.restore();
      return;
    }
    drawArrowHead(context, fromPoint, toPoint, color);
  }
  context.restore();
}

function drawBlock(
  context: CanvasRenderingContext2D,
  theme: GraphTheme,
  block: GraphBlockScene,
  graph: FunctionGraph,
  selectedBlockId: string | null,
  selectedVa: string,
  hoverHit: GraphHit | null,
) {
  const graphBlock = graph.blocks.find(
    (candidate) => candidate.id === block.id,
  );
  if (!graphBlock) {
    return;
  }

  const isSelectedBlock = selectedBlockId === block.id;
  const isFocusBlock = graph.focusBlockId === block.id;
  const hoveredRowVa =
    hoverHit?.type === "instruction" ? hoverHit.address : null;
  const isHoveredBlock =
    hoverHit?.type === "block"
      ? hoverHit.blockId === block.id
      : hoverHit?.type === "instruction"
        ? hoverHit.blockId === block.id
        : false;

  context.save();
  context.shadowColor = theme.blockShadow;
  context.shadowBlur = 18;
  context.shadowOffsetY = 6;
  context.fillStyle = theme.panelFill;
  drawRoundedRect(context, block.rect, BLOCK_RADIUS);
  context.fill();
  context.restore();

  context.save();
  drawRoundedRect(context, block.rect, BLOCK_RADIUS);
  context.clip();
  context.fillStyle = theme.headerFill;
  context.fillRect(block.rect.x, block.rect.y, block.rect.width, 34);
  context.restore();

  if (isHoveredBlock) {
    context.save();
    context.globalAlpha = 0.22;
    context.fillStyle = theme.hoverFill;
    drawRoundedRect(context, block.rect, BLOCK_RADIUS);
    context.fill();
    context.restore();
  }

  if (isSelectedBlock) {
    context.save();
    context.globalAlpha = 0.12;
    context.fillStyle = theme.selectedFill;
    drawRoundedRect(context, block.rect, BLOCK_RADIUS);
    context.fill();
    context.restore();
  }

  for (const row of block.rowRects) {
    if (row.address !== selectedVa && row.address !== hoveredRowVa) {
      continue;
    }
    context.save();
    context.fillStyle =
      row.address === selectedVa ? theme.selectedFill : theme.hoverFill;
    context.globalAlpha = row.address === selectedVa ? 0.16 : 0.2;
    drawRoundedRect(
      context,
      {
        x: row.rect.x - 4,
        y: row.rect.y - 1,
        width: row.rect.width + 8,
        height: row.rect.height + 2,
      },
      7,
    );
    context.fill();
    context.restore();
  }

  context.save();
  context.strokeStyle = isSelectedBlock
    ? theme.selectedFill
    : isFocusBlock
      ? theme.focusAccent
      : theme.panelStroke;
  context.lineWidth = isSelectedBlock ? 2.2 : isFocusBlock ? 1.8 : 1;
  drawRoundedRect(context, block.rect, BLOCK_RADIUS);
  context.stroke();

  context.strokeStyle = theme.panelStrokeSoft;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(block.rect.x, block.rect.y + 34);
  context.lineTo(block.rect.x + block.rect.width, block.rect.y + 34);
  context.stroke();

  context.font = HEADER_FONT;
  context.fillStyle = theme.textMuted;
  context.textBaseline = "middle";
  context.fillText(block.startVa, block.rect.x + 14, block.rect.y + 17);

  let badgeX = block.rect.x + block.rect.width - 52;
  if (block.isExit) {
    drawBadge(context, theme, "EXIT", badgeX, block.rect.y + 9);
    badgeX -= 48;
  }
  if (block.isEntry) {
    drawBadge(context, theme, "ENTRY", badgeX, block.rect.y + 9);
  }

  context.font = BODY_FONT;
  for (const row of block.rowRects) {
    const instruction = graphBlock.instructions[row.index];
    if (!instruction) {
      continue;
    }

    context.fillStyle =
      theme.mnemonics[instruction.instructionCategory] ?? theme.mnemonics.other;
    context.textBaseline = "middle";
    context.fillText(
      instruction.mnemonic,
      row.rect.x,
      row.rect.y + row.rect.height / 2,
    );

    const mnemonicWidth = Math.max(
      context.measureText(instruction.mnemonic).width,
      40,
    );
    context.fillStyle = theme.textSecondary;
    if (instruction.operands) {
      context.fillText(
        instruction.operands,
        row.rect.x + mnemonicWidth + 12,
        row.rect.y + row.rect.height / 2,
      );
    }
  }
  context.restore();
}

function drawGraph(
  context: CanvasRenderingContext2D,
  theme: GraphTheme,
  scene: GraphScene,
  graph: FunctionGraph,
  viewport: GraphViewport,
  size: { width: number; height: number },
  selectedBlockId: string | null,
  selectedVa: string,
  hoverHit: GraphHit | null,
) {
  context.clearRect(0, 0, size.width, size.height);
  context.save();
  context.translate(viewport.offsetX, viewport.offsetY);
  context.scale(viewport.zoom, viewport.zoom);
  for (const edge of scene.edges) {
    drawEdge(context, theme, edge);
  }
  for (const block of scene.blocks) {
    drawBlock(
      context,
      theme,
      block,
      graph,
      selectedBlockId,
      selectedVa,
      hoverHit,
    );
  }
  context.restore();
}

function containingBlockId(
  graph: FunctionGraph | null,
  address: string,
): string | null {
  if (!graph) {
    return null;
  }

  for (const block of graph.blocks) {
    if (
      block.instructions.some((instruction) => instruction.address === address)
    ) {
      return block.id;
    }
  }
  return null;
}

export function GraphPanel({
  isActive,
  moduleId,
  graph,
  selectedVa,
  onActivate,
  onSelectInstruction,
  onNavigateToInstruction,
}: GraphPanelProps) {
  const viewportRef = useRef<GraphViewport | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportElementRef = useRef<HTMLDivElement | null>(null);
  const activeGraphKeyRef = useRef("");
  const dragStateRef = useRef<{ clientX: number; clientY: number } | null>(
    null,
  );
  const [viewport, setViewport] = useState<GraphViewport | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [hoverHit, setHoverHit] = useState<GraphHit | null>(null);

  const scene = useMemo(() => (graph ? buildGraphScene(graph) : null), [graph]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    const container = viewportElementRef.current;
    if (!container) {
      return;
    }

    const syncSize = () => {
      const nextRect = container.getBoundingClientRect();
      setSize({
        width: Math.max(Math.floor(nextRect.width), 1),
        height: Math.max(Math.floor(nextRect.height), 1),
      });
    };

    syncSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncSize);
      return () => {
        window.removeEventListener("resize", syncSize);
      };
    }

    const observer = new ResizeObserver(() => {
      syncSize();
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const blockId = containingBlockId(graph, selectedVa);
    if (blockId) {
      setSelectedBlockId(blockId);
    }
  }, [graph, selectedVa]);

  useEffect(() => {
    if (!graph || !scene || size.width <= 0 || size.height <= 0) {
      return;
    }

    const graphKey = `${graph.functionStartVa}:${graph.focusBlockId}`;
    if (activeGraphKeyRef.current === graphKey && viewportRef.current) {
      return;
    }

    activeGraphKeyRef.current = graphKey;
    setSelectedBlockId(
      containingBlockId(graph, selectedVa) ?? graph.focusBlockId,
    );
    setViewport(centerViewportOnBlock(scene, graph.focusBlockId, size, 1));
  }, [graph, scene, selectedVa, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = viewportElementRef.current;
    if (!canvas || !container || !scene || !graph || !viewport) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(size.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.floor(size.height * devicePixelRatio));
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    drawGraph(
      context,
      getGraphTheme(container),
      scene,
      graph,
      viewport,
      size,
      selectedBlockId,
      selectedVa,
      hoverHit,
    );
  }, [graph, hoverHit, scene, selectedBlockId, selectedVa, size, viewport]);

  const resolveScenePoint = (
    clientX: number,
    clientY: number,
  ): GraphPoint | null => {
    const container = viewportElementRef.current;
    const currentViewport = viewportRef.current;
    if (!container || !currentViewport) {
      return null;
    }

    const rect = container.getBoundingClientRect();
    return graphPointFromClientPoint(currentViewport, {
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragStateRef.current && viewportRef.current) {
      const deltaX = event.clientX - dragStateRef.current.clientX;
      const deltaY = event.clientY - dragStateRef.current.clientY;
      dragStateRef.current = { clientX: event.clientX, clientY: event.clientY };
      setViewport((currentViewport) =>
        currentViewport
          ? {
              ...currentViewport,
              offsetX: currentViewport.offsetX + deltaX,
              offsetY: currentViewport.offsetY + deltaY,
            }
          : currentViewport,
      );
      return;
    }

    if (!scene) {
      return;
    }

    const scenePoint = resolveScenePoint(event.clientX, event.clientY);
    if (!scenePoint) {
      return;
    }

    setHoverHit(findGraphHit(scene, scenePoint));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return;
    }
    onActivate();
    canvasRef.current?.focus();

    if (!scene) {
      return;
    }

    const scenePoint = resolveScenePoint(event.clientX, event.clientY);
    if (!scenePoint) {
      return;
    }

    const hit = findGraphHit(scene, scenePoint);
    setHoverHit(hit);

    if (hit?.type === "instruction") {
      setSelectedBlockId(hit.blockId);
      onSelectInstruction(hit.address);
      return;
    }

    if (hit?.type === "block") {
      setSelectedBlockId(hit.blockId);
      return;
    }

    dragStateRef.current = { clientX: event.clientX, clientY: event.clientY };
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    dragStateRef.current = null;
    if (typeof event.currentTarget.releasePointerCapture === "function") {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // no-op when the pointer was not captured
      }
    }
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!scene) {
      return;
    }
    const scenePoint = resolveScenePoint(event.clientX, event.clientY);
    if (!scenePoint) {
      return;
    }
    const hit = findGraphHit(scene, scenePoint);
    if (hit?.type === "instruction") {
      void onNavigateToInstruction(hit.address);
    }
  };

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    if (!viewportRef.current) {
      return;
    }
    event.preventDefault();
    onActivate();
    const container = viewportElementRef.current;
    if (!container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const clientPoint = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    const zoomFactor = Math.exp(-event.deltaY * 0.0012);
    setViewport(
      zoomViewportAtPoint(
        viewportRef.current,
        clientPoint,
        viewportRef.current.zoom * zoomFactor,
      ),
    );
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (!scene || !graph) {
      return;
    }

    if (event.key === "Enter" && selectedVa) {
      event.preventDefault();
      void onNavigateToInstruction(selectedVa);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setSelectedBlockId(null);
      setHoverHit(null);
      return;
    }

    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      setViewport(fitSceneViewport(scene, size));
      return;
    }

    if (event.key === "0") {
      event.preventDefault();
      setViewport(
        centerViewportOnBlock(
          scene,
          selectedBlockId ?? graph.focusBlockId,
          size,
          1,
        ),
      );
    }
  };

  const selectedBlockMeta = graph
    ? (graph.blocks.find((block) => block.id === selectedBlockId) ?? null)
    : null;

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
        {graph && scene ? (
          <div
            ref={viewportElementRef}
            className="graph-canvas-shell relative h-full min-h-0 w-full overflow-hidden bg-[radial-gradient(circle_at_top,_oklch(var(--secondary)/0.45),_transparent_45%),linear-gradient(180deg,_oklch(var(--background)),_oklch(var(--secondary)/0.22))] outline-none"
          >
            <canvas
              aria-label="Function graph canvas"
              className="block h-full w-full cursor-grab active:cursor-grabbing"
              data-testid="graph-canvas"
              onDoubleClick={handleDoubleClick}
              onKeyDown={handleKeyDown}
              onPointerDown={handlePointerDown}
              onPointerLeave={() => {
                if (!dragStateRef.current) {
                  setHoverHit(null);
                }
              }}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onWheel={handleWheel}
              ref={canvasRef}
              tabIndex={0}
            />
            <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-border/70 bg-card/90 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
              <span>
                Wheel zooms. Drag empty space to pan. <kbd>F</kbd> fits.{" "}
                <kbd>0</kbd> resets.
              </span>
            </div>
            {selectedBlockMeta ? (
              <div className="pointer-events-none absolute right-3 top-3 rounded-md border border-border/70 bg-card/92 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
                {selectedBlockMeta.startVa}
                {selectedVa ? ` | ${selectedVa}` : ""}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full select-none items-center justify-center text-xs text-muted-foreground">
            No graph loaded.
          </div>
        )}
      </AppPanelBody>
    </AppPanel>
  );
}

export {
  buildGraphScene,
  centerViewportOnBlock,
  findGraphHit,
  fitSceneViewport,
  screenPointForScenePoint,
};
