import type { HexAddress, MethodResult } from "../../../shared";

export type FunctionGraph = MethodResult["function.getGraphByVa"];

type GraphBlock = FunctionGraph["blocks"][number];
type GraphEdge = FunctionGraph["edges"][number];

type TextMeasureKind = "header" | "mnemonic" | "operands" | "badge";

export type GraphViewport = {
  offsetX: number;
  offsetY: number;
  zoom: number;
};

export type GraphInstructionRowScene = {
  address: HexAddress;
  blockId: string;
  index: number;
  rect: GraphRect;
};

export type GraphBlockScene = {
  id: string;
  startVa: HexAddress;
  endVa: HexAddress;
  isEntry: boolean;
  isExit: boolean;
  rank: number;
  column: number;
  rect: GraphRect;
  rowRects: GraphInstructionRowScene[];
};

export type GraphEdgeScene = {
  id: string;
  fromBlockId: string;
  toBlockId: string;
  kind: GraphEdge["kind"];
  sourceInstructionVa: HexAddress;
  isBackEdge: boolean;
  points: GraphPoint[];
};

export type GraphRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GraphPoint = {
  x: number;
  y: number;
};

export type GraphScene = {
  blocks: GraphBlockScene[];
  edges: GraphEdgeScene[];
  bounds: GraphRect;
};

export type GraphHit =
  | {
      type: "instruction";
      address: HexAddress;
      blockId: string;
    }
  | {
      type: "block";
      blockId: string;
    };

type BuildSceneOptions = {
  measureText?: (text: string, kind: TextMeasureKind) => number;
};

const SCENE_PADDING = 72;
const SIDE_GUTTER = 132;
const BACK_EDGE_GUTTER_STEP = 40;
const BLOCK_MIN_WIDTH = 260;
const BLOCK_MAX_WIDTH = 560;
const BLOCK_PADDING_X = 16;
const BLOCK_PADDING_Y = 14;
const BLOCK_HEADER_HEIGHT = 28;
const BLOCK_BADGE_GAP = 6;
const BLOCK_ROW_HEIGHT = 18;
const BLOCK_ROW_GAP = 3;
const BLOCK_COLUMN_GAP = 56;
const RANK_GAP = 116;
const EDGE_STUB = 18;
const FORWARD_LANE_STEP = 18;

function parseHexAddress(address: HexAddress): number {
  return Number.parseInt(address.replace(/^0x/i, ""), 16);
}

function defaultMeasureText(text: string, kind: TextMeasureKind): number {
  const charWidth =
    kind === "header"
      ? 7.2
      : kind === "badge"
        ? 6.1
        : kind === "mnemonic"
          ? 7
          : 6.8;
  return text.length * charWidth;
}

function blockCenterX(block: GraphBlockScene): number {
  return block.rect.x + block.rect.width / 2;
}

function blockCenterY(block: GraphBlockScene): number {
  return block.rect.y + block.rect.height / 2;
}

type SccResult = {
  sccIndexByNodeId: Map<string, number>;
  nodesByScc: string[][];
};

function buildStronglyConnectedComponents(
  nodeIds: string[],
  outgoingByNodeId: Map<string, string[]>,
): SccResult {
  let nextIndex = 0;
  const stack: string[] = [];
  const indexByNodeId = new Map<string, number>();
  const lowLinkByNodeId = new Map<string, number>();
  const onStack = new Set<string>();
  const nodesByScc: string[][] = [];
  const sccIndexByNodeId = new Map<string, number>();

  const visit = (nodeId: string) => {
    indexByNodeId.set(nodeId, nextIndex);
    lowLinkByNodeId.set(nodeId, nextIndex);
    nextIndex += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const targetId of outgoingByNodeId.get(nodeId) ?? []) {
      if (!indexByNodeId.has(targetId)) {
        visit(targetId);
        lowLinkByNodeId.set(
          nodeId,
          Math.min(
            lowLinkByNodeId.get(nodeId) ?? Number.POSITIVE_INFINITY,
            lowLinkByNodeId.get(targetId) ?? Number.POSITIVE_INFINITY,
          ),
        );
      } else if (onStack.has(targetId)) {
        lowLinkByNodeId.set(
          nodeId,
          Math.min(
            lowLinkByNodeId.get(nodeId) ?? Number.POSITIVE_INFINITY,
            indexByNodeId.get(targetId) ?? Number.POSITIVE_INFINITY,
          ),
        );
      }
    }

    if (lowLinkByNodeId.get(nodeId) !== indexByNodeId.get(nodeId)) {
      return;
    }

    const nodes: string[] = [];
    while (stack.length > 0) {
      const currentNodeId = stack.pop();
      if (!currentNodeId) {
        break;
      }
      onStack.delete(currentNodeId);
      sccIndexByNodeId.set(currentNodeId, nodesByScc.length);
      nodes.push(currentNodeId);
      if (currentNodeId === nodeId) {
        break;
      }
    }
    nodesByScc.push(nodes);
  };

  for (const nodeId of nodeIds) {
    if (!indexByNodeId.has(nodeId)) {
      visit(nodeId);
    }
  }

  return { sccIndexByNodeId, nodesByScc };
}

function buildVisitOrder(
  entryBlockId: string,
  blocksById: Map<string, GraphBlock>,
  edgesBySourceId: Map<string, GraphEdge[]>,
): Map<string, number> {
  const visitOrder = new Map<string, number>();
  let nextOrder = 0;

  const visit = (blockId: string) => {
    if (visitOrder.has(blockId)) {
      return;
    }
    visitOrder.set(blockId, nextOrder);
    nextOrder += 1;

    const sortedEdges = [...(edgesBySourceId.get(blockId) ?? [])].sort(
      (left, right) => {
        const leftBlock = blocksById.get(left.toBlockId);
        const rightBlock = blocksById.get(right.toBlockId);
        const leftKind =
          left.kind === "fallthrough" ? 0 : left.kind === "conditional" ? 1 : 2;
        const rightKind =
          right.kind === "fallthrough"
            ? 0
            : right.kind === "conditional"
              ? 1
              : 2;

        if (leftKind !== rightKind) {
          return leftKind - rightKind;
        }
        return (
          parseHexAddress(leftBlock?.startVa ?? "0x0") -
          parseHexAddress(rightBlock?.startVa ?? "0x0")
        );
      },
    );

    for (const edge of sortedEdges) {
      visit(edge.toBlockId);
    }
  };

  visit(entryBlockId);

  const sortedBlockIds = [...blocksById.values()]
    .sort(
      (left, right) =>
        parseHexAddress(left.startVa) - parseHexAddress(right.startVa),
    )
    .map((block) => block.id);
  for (const blockId of sortedBlockIds) {
    visit(blockId);
  }

  return visitOrder;
}

type MeasuredBlock = {
  width: number;
  height: number;
};

function measureBlock(
  block: GraphBlock,
  measureText: (text: string, kind: TextMeasureKind) => number,
): MeasuredBlock {
  let maxRowWidth = measureText(block.startVa, "header");
  let badgeWidth = 0;
  if (block.isEntry) {
    badgeWidth += measureText("ENTRY", "badge") + 18;
  }
  if (block.isExit) {
    badgeWidth +=
      (badgeWidth > 0 ? BLOCK_BADGE_GAP : 0) +
      measureText("EXIT", "badge") +
      18;
  }

  for (const instruction of block.instructions) {
    const mnemonicWidth = Math.max(
      measureText(instruction.mnemonic, "mnemonic"),
      40,
    );
    const operandsWidth = instruction.operands
      ? measureText(instruction.operands, "operands") + 10
      : 0;
    maxRowWidth = Math.max(maxRowWidth, mnemonicWidth + operandsWidth);
  }

  const width = Math.max(
    BLOCK_MIN_WIDTH,
    Math.min(
      BLOCK_MAX_WIDTH,
      maxRowWidth + badgeWidth + BLOCK_PADDING_X * 2 + 20,
    ),
  );
  const rowCount = Math.max(block.instructions.length, 1);
  const height =
    BLOCK_PADDING_Y * 2 +
    BLOCK_HEADER_HEIGHT +
    rowCount * BLOCK_ROW_HEIGHT +
    Math.max(0, rowCount - 1) * BLOCK_ROW_GAP;

  return { width, height };
}

function buildRankByBlockId(
  blocksById: Map<string, GraphBlock>,
  outgoingByNodeId: Map<string, string[]>,
  entryBlockId: string,
): Map<string, number> {
  const { nodesByScc, sccIndexByNodeId } = buildStronglyConnectedComponents(
    [...blocksById.keys()],
    outgoingByNodeId,
  );
  const condensedOutgoing = new Map<number, Set<number>>();
  const incomingCount = new Map<number, number>();

  for (let sccIndex = 0; sccIndex < nodesByScc.length; sccIndex += 1) {
    condensedOutgoing.set(sccIndex, new Set());
    incomingCount.set(sccIndex, 0);
  }

  for (const [nodeId, targets] of outgoingByNodeId) {
    const fromScc = sccIndexByNodeId.get(nodeId);
    if (fromScc === undefined) {
      continue;
    }
    for (const targetId of targets) {
      const toScc = sccIndexByNodeId.get(targetId);
      if (toScc === undefined || toScc === fromScc) {
        continue;
      }
      const outgoing = condensedOutgoing.get(fromScc);
      if (!outgoing || outgoing.has(toScc)) {
        continue;
      }
      outgoing.add(toScc);
      incomingCount.set(toScc, (incomingCount.get(toScc) ?? 0) + 1);
    }
  }

  const rankByScc = new Map<number, number>();
  const queue: number[] = [];
  const entryScc = sccIndexByNodeId.get(entryBlockId) ?? 0;
  rankByScc.set(entryScc, 0);
  queue.push(entryScc);

  while (queue.length > 0) {
    const currentScc = queue.shift();
    if (currentScc === undefined) {
      break;
    }
    const currentRank = rankByScc.get(currentScc) ?? 0;
    for (const targetScc of condensedOutgoing.get(currentScc) ?? []) {
      const nextRank = currentRank + 1;
      if ((rankByScc.get(targetScc) ?? -1) < nextRank) {
        rankByScc.set(targetScc, nextRank);
      }
      const nextIncoming = (incomingCount.get(targetScc) ?? 0) - 1;
      incomingCount.set(targetScc, nextIncoming);
      if (nextIncoming <= 0) {
        queue.push(targetScc);
      }
    }
  }

  for (let sccIndex = 0; sccIndex < nodesByScc.length; sccIndex += 1) {
    if (!rankByScc.has(sccIndex)) {
      rankByScc.set(sccIndex, 0);
    }
  }

  const rankByBlockId = new Map<string, number>();
  for (const [nodeId, sccIndex] of sccIndexByNodeId) {
    rankByBlockId.set(nodeId, rankByScc.get(sccIndex) ?? 0);
  }
  return rankByBlockId;
}

function rectContainsPoint(rect: GraphRect, point: GraphPoint): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

export function buildGraphScene(
  graph: FunctionGraph,
  options: BuildSceneOptions = {},
): GraphScene {
  const measureText = options.measureText ?? defaultMeasureText;
  const blocks = [...graph.blocks].sort(
    (left, right) =>
      parseHexAddress(left.startVa) - parseHexAddress(right.startVa),
  );
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const edges = graph.edges.filter(
    (edge) =>
      blocksById.has(edge.fromBlockId) && blocksById.has(edge.toBlockId),
  );
  const edgesBySourceId = new Map<string, GraphEdge[]>();
  const outgoingByNodeId = new Map<string, string[]>();

  for (const block of blocks) {
    edgesBySourceId.set(block.id, []);
    outgoingByNodeId.set(block.id, []);
  }

  for (const edge of edges) {
    edgesBySourceId.get(edge.fromBlockId)?.push(edge);
    outgoingByNodeId.get(edge.fromBlockId)?.push(edge.toBlockId);
  }

  const entryBlock =
    blocks.find((block) => block.isEntry) ??
    blocks.find((block) => block.id === graph.focusBlockId) ??
    blocks[0];
  const entryBlockId = entryBlock?.id ?? "";
  const visitOrder = buildVisitOrder(entryBlockId, blocksById, edgesBySourceId);
  const rankByBlockId = buildRankByBlockId(
    blocksById,
    outgoingByNodeId,
    entryBlockId,
  );
  const measuredByBlockId = new Map(
    blocks.map((block) => [block.id, measureBlock(block, measureText)]),
  );
  const blocksByRank = new Map<number, GraphBlock[]>();

  for (const block of blocks) {
    const rank = rankByBlockId.get(block.id) ?? 0;
    const existing = blocksByRank.get(rank);
    if (existing) {
      existing.push(block);
    } else {
      blocksByRank.set(rank, [block]);
    }
  }

  const ranks = [...blocksByRank.keys()].sort((left, right) => left - right);
  const rankWidths = new Map<number, number>();
  const rankHeights = new Map<number, number>();

  for (const rank of ranks) {
    const rankBlocks = [...(blocksByRank.get(rank) ?? [])].sort(
      (left, right) => {
        const leftOrder = visitOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = visitOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
        return parseHexAddress(left.startVa) - parseHexAddress(right.startVa);
      },
    );
    blocksByRank.set(rank, rankBlocks);
    rankWidths.set(
      rank,
      rankBlocks.reduce((total, block, index) => {
        const measured = measuredByBlockId.get(block.id);
        if (!measured) {
          return total;
        }
        return total + measured.width + (index > 0 ? BLOCK_COLUMN_GAP : 0);
      }, 0),
    );
    rankHeights.set(
      rank,
      rankBlocks.reduce(
        (maxHeight, block) =>
          Math.max(maxHeight, measuredByBlockId.get(block.id)?.height ?? 0),
        0,
      ),
    );
  }

  const maxRankWidth = Math.max(...[0, ...rankWidths.values()]);
  const blockSceneById = new Map<string, GraphBlockScene>();
  const rowSceneByAddress = new Map<HexAddress, GraphInstructionRowScene>();
  const blocksScene: GraphBlockScene[] = [];
  let currentY = SCENE_PADDING;

  for (const rank of ranks) {
    const rankBlocks = blocksByRank.get(rank) ?? [];
    const rankWidth = rankWidths.get(rank) ?? 0;
    let currentX =
      SCENE_PADDING + SIDE_GUTTER + Math.max(0, (maxRankWidth - rankWidth) / 2);

    for (const [column, block] of rankBlocks.entries()) {
      const measured = measuredByBlockId.get(block.id);
      if (!measured) {
        continue;
      }

      const rowRects = block.instructions.map((instruction, index) => {
        const rect = {
          x: currentX + BLOCK_PADDING_X,
          y:
            currentY +
            BLOCK_PADDING_Y +
            BLOCK_HEADER_HEIGHT +
            index * (BLOCK_ROW_HEIGHT + BLOCK_ROW_GAP),
          width: measured.width - BLOCK_PADDING_X * 2,
          height: BLOCK_ROW_HEIGHT,
        };
        const rowScene = {
          address: instruction.address,
          blockId: block.id,
          index,
          rect,
        };
        rowSceneByAddress.set(instruction.address, rowScene);
        return rowScene;
      });

      const blockScene = {
        id: block.id,
        startVa: block.startVa,
        endVa: block.endVa,
        isEntry: block.isEntry,
        isExit: block.isExit,
        rank,
        column,
        rect: {
          x: currentX,
          y: currentY,
          width: measured.width,
          height: measured.height,
        },
        rowRects,
      };
      blockSceneById.set(block.id, blockScene);
      blocksScene.push(blockScene);
      currentX += measured.width + BLOCK_COLUMN_GAP;
    }

    currentY += (rankHeights.get(rank) ?? 0) + RANK_GAP;
  }

  const sceneMinX = Math.min(...blocksScene.map((block) => block.rect.x));
  const sceneMaxX = Math.max(
    ...blocksScene.map((block) => block.rect.x + block.rect.width),
  );
  const sceneMinY = Math.min(...blocksScene.map((block) => block.rect.y));
  const sceneMaxY = Math.max(
    ...blocksScene.map((block) => block.rect.y + block.rect.height),
  );
  const forwardLaneIndexByEdgeId = new Map<string, number>();
  const backEdgeLaneIndexByEdgeId = new Map<string, number>();
  const forwardGroups = new Map<string, GraphEdge[]>();
  const leftBackEdges: GraphEdge[] = [];
  const rightBackEdges: GraphEdge[] = [];
  const sceneCenterX = (sceneMinX + sceneMaxX) / 2;

  for (const edge of edges) {
    const fromBlock = blockSceneById.get(edge.fromBlockId);
    const toBlock = blockSceneById.get(edge.toBlockId);
    if (!fromBlock || !toBlock) {
      continue;
    }
    const isBackEdge = edge.isBackEdge || toBlock.rank <= fromBlock.rank;
    if (isBackEdge) {
      const useLeft =
        (blockCenterX(fromBlock) + blockCenterX(toBlock)) / 2 < sceneCenterX;
      if (useLeft) {
        leftBackEdges.push(edge);
      } else {
        rightBackEdges.push(edge);
      }
      continue;
    }
    const groupKey = `${fromBlock.rank}:${toBlock.rank}`;
    const existing = forwardGroups.get(groupKey);
    if (existing) {
      existing.push(edge);
    } else {
      forwardGroups.set(groupKey, [edge]);
    }
  }

  for (const groupedEdges of forwardGroups.values()) {
    groupedEdges
      .sort((left, right) => {
        const leftBlock = blockSceneById.get(left.fromBlockId);
        const rightBlock = blockSceneById.get(right.fromBlockId);
        return (
          (leftBlock ? blockCenterX(leftBlock) : 0) -
          (rightBlock ? blockCenterX(rightBlock) : 0)
        );
      })
      .forEach((edge, index, source) => {
        forwardLaneIndexByEdgeId.set(edge.id, index - (source.length - 1) / 2);
      });
  }

  leftBackEdges
    .sort(
      (left, right) =>
        parseHexAddress(left.sourceInstructionVa) -
        parseHexAddress(right.sourceInstructionVa),
    )
    .forEach((edge, index) => {
      backEdgeLaneIndexByEdgeId.set(edge.id, -(index + 1));
    });
  rightBackEdges
    .sort(
      (left, right) =>
        parseHexAddress(left.sourceInstructionVa) -
        parseHexAddress(right.sourceInstructionVa),
    )
    .forEach((edge, index) => {
      backEdgeLaneIndexByEdgeId.set(edge.id, index + 1);
    });

  const edgeScene: GraphEdgeScene[] = [];
  const pointBounds = {
    minX: sceneMinX,
    maxX: sceneMaxX,
    minY: sceneMinY,
    maxY: sceneMaxY,
  };

  for (const edge of edges) {
    const fromBlock = blockSceneById.get(edge.fromBlockId);
    const toBlock = blockSceneById.get(edge.toBlockId);
    const sourceRow = rowSceneByAddress.get(edge.sourceInstructionVa);
    if (!fromBlock || !toBlock) {
      continue;
    }

    const isBackEdge = edge.isBackEdge || toBlock.rank <= fromBlock.rank;
    const sourceX = blockCenterX(fromBlock);
    const targetX = blockCenterX(toBlock);
    const sourceY = fromBlock.rect.y + fromBlock.rect.height;
    const targetY = toBlock.rect.y;
    let points: GraphPoint[];

    if (isBackEdge) {
      const laneIndex = backEdgeLaneIndexByEdgeId.get(edge.id) ?? -1;
      const gutterX =
        laneIndex < 0
          ? sceneMinX - 52 + laneIndex * BACK_EDGE_GUTTER_STEP
          : sceneMaxX + 52 + laneIndex * BACK_EDGE_GUTTER_STEP;
      const sourceSideX =
        laneIndex < 0
          ? fromBlock.rect.x
          : fromBlock.rect.x + fromBlock.rect.width;
      const targetSideX =
        laneIndex < 0 ? toBlock.rect.x : toBlock.rect.x + toBlock.rect.width;
      const targetSideY = blockCenterY(toBlock);
      points = [
        { x: sourceSideX, y: sourceRow?.rect.y ?? blockCenterY(fromBlock) },
        { x: gutterX, y: sourceRow?.rect.y ?? blockCenterY(fromBlock) },
        { x: gutterX, y: targetSideY },
        { x: targetSideX, y: targetSideY },
      ];
    } else {
      const laneOffset =
        (forwardLaneIndexByEdgeId.get(edge.id) ?? 0) * FORWARD_LANE_STEP;
      const laneX = (sourceX + targetX) / 2 + laneOffset;
      points = [
        { x: sourceX, y: sourceY },
        { x: sourceX, y: sourceY + EDGE_STUB },
        { x: laneX, y: sourceY + EDGE_STUB },
        { x: laneX, y: targetY - EDGE_STUB },
        { x: targetX, y: targetY - EDGE_STUB },
        { x: targetX, y: targetY },
      ];
    }

    for (const point of points) {
      pointBounds.minX = Math.min(pointBounds.minX, point.x);
      pointBounds.maxX = Math.max(pointBounds.maxX, point.x);
      pointBounds.minY = Math.min(pointBounds.minY, point.y);
      pointBounds.maxY = Math.max(pointBounds.maxY, point.y);
    }

    edgeScene.push({
      id: edge.id,
      fromBlockId: edge.fromBlockId,
      toBlockId: edge.toBlockId,
      kind: edge.kind,
      sourceInstructionVa: edge.sourceInstructionVa,
      isBackEdge,
      points,
    });
  }

  return {
    blocks: blocksScene,
    edges: edgeScene,
    bounds: {
      x: pointBounds.minX - SCENE_PADDING,
      y: pointBounds.minY - SCENE_PADDING,
      width: pointBounds.maxX - pointBounds.minX + SCENE_PADDING * 2,
      height: pointBounds.maxY - pointBounds.minY + SCENE_PADDING * 2,
    },
  };
}

export function findGraphHit(
  scene: GraphScene,
  point: GraphPoint,
): GraphHit | null {
  for (const block of scene.blocks) {
    for (const row of block.rowRects) {
      if (rectContainsPoint(row.rect, point)) {
        return {
          type: "instruction",
          address: row.address,
          blockId: row.blockId,
        };
      }
    }
  }

  for (const block of scene.blocks) {
    if (rectContainsPoint(block.rect, point)) {
      return {
        type: "block",
        blockId: block.id,
      };
    }
  }

  return null;
}

export function fitSceneViewport(
  scene: GraphScene,
  viewportSize: { width: number; height: number },
): GraphViewport {
  const innerPadding = 32;
  const zoom = clampZoom(
    Math.min(
      (viewportSize.width - innerPadding * 2) / scene.bounds.width,
      (viewportSize.height - innerPadding * 2) / scene.bounds.height,
      1.15,
    ),
  );
  return {
    zoom,
    offsetX:
      viewportSize.width / 2 - (scene.bounds.x + scene.bounds.width / 2) * zoom,
    offsetY:
      viewportSize.height / 2 -
      (scene.bounds.y + scene.bounds.height / 2) * zoom,
  };
}

export function centerViewportOnBlock(
  scene: GraphScene,
  blockId: string,
  viewportSize: { width: number; height: number },
  zoom = 1,
): GraphViewport {
  const block = scene.blocks.find((candidate) => candidate.id === blockId);
  if (!block) {
    return fitSceneViewport(scene, viewportSize);
  }

  return {
    zoom: clampZoom(zoom),
    offsetX: viewportSize.width / 2 - blockCenterX(block) * zoom,
    offsetY: viewportSize.height / 2 - blockCenterY(block) * zoom,
  };
}

export function graphPointFromClientPoint(
  viewport: GraphViewport,
  clientPoint: GraphPoint,
): GraphPoint {
  return {
    x: (clientPoint.x - viewport.offsetX) / viewport.zoom,
    y: (clientPoint.y - viewport.offsetY) / viewport.zoom,
  };
}

export function screenPointForScenePoint(
  viewport: GraphViewport,
  scenePoint: GraphPoint,
): GraphPoint {
  return {
    x: scenePoint.x * viewport.zoom + viewport.offsetX,
    y: scenePoint.y * viewport.zoom + viewport.offsetY,
  };
}

export function zoomViewportAtPoint(
  viewport: GraphViewport,
  clientPoint: GraphPoint,
  nextZoom: number,
): GraphViewport {
  const zoom = clampZoom(nextZoom);
  const scenePoint = graphPointFromClientPoint(viewport, clientPoint);
  return {
    zoom,
    offsetX: clientPoint.x - scenePoint.x * zoom,
    offsetY: clientPoint.y - scenePoint.y * zoom,
  };
}

export function clampZoom(value: number): number {
  return Math.min(2.5, Math.max(0.35, value));
}
