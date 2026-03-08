import { parseHexVa } from "@/features/shared/number-utils";
import { cn } from "@/lib/utils";
import { useId } from "react";
import type { MouseEvent } from "react";
import type {
  MemoryOverviewSliceKind,
  MethodResult,
} from "../../../shared/protocol";

const BAR_VIEWBOX_WIDTH = 1000;
const BAR_HEIGHT = 28;

type MemoryOverviewBarProps = {
  overview: MethodResult["module.getMemoryOverview"] | null;
  markerVa: number | null;
  onNavigate?: (va: string) => void;
};

const emptyLabelStyle = {
  fill: "oklch(var(--foreground) / 0.1)",
  fontSize: "10px",
  fontWeight: 400,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  userSelect: "none" as const,
};

export function MemoryOverviewBar({
  overview,
  markerVa,
  onNavigate,
}: MemoryOverviewBarProps) {
  const emptyPatternId = useId().replace(/:/g, "");

  const startVa = overview ? parseHexVa(overview.startVa) : null;
  const endVa = overview ? parseHexVa(overview.endVa) : null;

  if (
    overview === null ||
    startVa === null ||
    endVa === null ||
    endVa <= startVa ||
    overview.slices.length === 0
  ) {
    return (
      <div
        className="-mx-2 flex-none p-0"
        aria-label="Memory overview"
        data-testid="memory-overview"
      >
        <svg
          className="block h-7 w-full bg-[var(--memory-rail)]"
          data-testid="memory-overview-empty-bar"
          viewBox={`0 0 ${BAR_VIEWBOX_WIDTH} ${BAR_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Empty memory layout"
        >
          <defs>
            <pattern
              id={emptyPatternId}
              width="150"
              height="54"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(-28)"
            >
              <text style={emptyLabelStyle} x="8" y="18">
                Memory Bar
              </text>
              <text style={emptyLabelStyle} x="74" y="45">
                Memory Bar
              </text>
            </pattern>
          </defs>
          <rect
            data-testid="memory-overview-empty"
            x={0}
            y={0}
            width={BAR_VIEWBOX_WIDTH}
            height={BAR_HEIGHT}
            fill={`url(#${emptyPatternId})`}
          />
        </svg>
      </div>
    );
  }

  const activeOverview = overview;
  const overviewStartVa = startVa;
  const overviewEndVa = endVa;
  const rangeSpan = overviewEndVa - overviewStartVa;
  const sliceCount = activeOverview.slices.length;

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (!onNavigate) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return;
    }

    const ratio = clampToViewBox((event.clientX - rect.left) / rect.width, 1);
    const targetVa = Math.floor(overviewStartVa + rangeSpan * ratio);
    onNavigate(`0x${targetVa.toString(16)}`);
  }

  const markerX =
    markerVa === null
      ? null
      : clampToViewBox(
          ((markerVa - overviewStartVa) / rangeSpan) * BAR_VIEWBOX_WIDTH,
          BAR_VIEWBOX_WIDTH,
        );

  return (
    <div
      className="-mx-2 flex-none p-0"
      aria-label="Memory overview"
      data-testid="memory-overview"
    >
      <button
        type="button"
        className="block w-full border-0 bg-transparent p-0"
        data-testid="memory-overview-button"
        onClick={handleClick}
        aria-label="Jump disassembly using memory overview"
      >
        <svg
          className={cn(
            "block h-7 w-full bg-[var(--memory-rail)]",
            onNavigate && "cursor-pointer",
          )}
          viewBox={`0 0 ${BAR_VIEWBOX_WIDTH} ${BAR_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {activeOverview.slices.map((slice, index) => {
            const x = (index / sliceCount) * BAR_VIEWBOX_WIDTH;
            const endX = ((index + 1) / sliceCount) * BAR_VIEWBOX_WIDTH;
            const width = Math.max(1, endX - x);
            const sliceStartVa =
              overviewStartVa + Math.floor((index * rangeSpan) / sliceCount);

            return (
              <rect
                key={`${slice}-${sliceStartVa.toString(16)}`}
                data-testid={`memory-slice-${slice}`}
                fill={sliceFill(slice)}
                shapeRendering="crispEdges"
                x={x}
                y={0}
                width={width}
                height={BAR_HEIGHT}
              >
                <title>
                  {formatSliceTitle(
                    slice,
                    sliceStartVa,
                    overviewStartVa +
                      Math.floor(((index + 1) * rangeSpan) / sliceCount),
                  )}
                </title>
              </rect>
            );
          })}
          {markerX !== null ? (
            <line
              data-testid="memory-overview-viewport"
              filter="drop-shadow(0 0 4px oklch(var(--foreground) / 0.18))"
              stroke="var(--memory-viewport)"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              x1={markerX}
              x2={markerX}
              y1={1}
              y2={BAR_HEIGHT - 1}
            />
          ) : null}
        </svg>
      </button>
    </div>
  );
}

function sliceFill(slice: MemoryOverviewSliceKind) {
  switch (slice) {
    case "unmapped":
      return "var(--memory-unmapped)";
    case "ro":
      return "var(--memory-ro)";
    case "rw":
      return "var(--memory-rw)";
    case "rwx":
      return "var(--memory-rwx)";
    case "explored":
      return "var(--memory-explored)";
    case "unexplored":
      return "var(--memory-unexplored)";
  }
}

function formatSliceTitle(
  slice: MemoryOverviewSliceKind,
  sliceStartVa: number,
  sliceEndVa: number,
) {
  return `Approx ${formatSliceLabel(slice)} ${toHex(sliceStartVa)} - ${toHex(sliceEndVa)}`;
}

function formatSliceLabel(slice: MemoryOverviewSliceKind) {
  switch (slice) {
    case "unmapped":
      return "unmapped";
    case "ro":
      return "read-only";
    case "rw":
      return "read-write";
    case "rwx":
      return "read-write-execute";
    case "explored":
      return "explored";
    case "unexplored":
      return "unexplored";
  }
}

function clampToViewBox(value: number, upperBound: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), upperBound);
}

function toHex(value: number) {
  return `0x${value.toString(16)}`;
}
