import { parseHexVa } from "@/features/shared/number-utils";
import { useId } from "react";
import type { MouseEvent } from "react";
import type { MethodResult } from "../../../shared/protocol";

const BAR_VIEWBOX_WIDTH = 1000;
const BAR_HEIGHT = 28;

type MemoryOverviewBarProps = {
  overview: MethodResult["module.getMemoryOverview"] | null;
  markerVa: number | null;
  onNavigate?: (va: string) => void;
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
    endVa <= startVa
  ) {
    return (
      <div className="memory-overview-shell" aria-label="Memory overview">
        <svg
          className="memory-overview-bar"
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
              <text x="8" y="18" className="memory-overview-empty-label">
                Memory Bar
              </text>
              <text x="74" y="45" className="memory-overview-empty-label">
                Memory Bar
              </text>
            </pattern>
          </defs>
          <rect
            className="memory-overview-empty-overlay"
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
    <div className="memory-overview-shell" aria-label="Memory overview">
      <button
        type="button"
        className="memory-overview-button"
        onClick={handleClick}
        aria-label="Jump disassembly using memory overview"
      >
        <svg
          className={`memory-overview-bar${onNavigate ? " is-interactive" : ""}`}
          viewBox={`0 0 ${BAR_VIEWBOX_WIDTH} ${BAR_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {activeOverview.regions.map((region) => {
            const regionStart = parseHexVa(region.startVa);
            const regionEnd = parseHexVa(region.endVa);
            if (
              regionStart === null ||
              regionEnd === null ||
              regionEnd <= regionStart ||
              regionEnd <= overviewStartVa ||
              regionStart >= overviewEndVa
            ) {
              return null;
            }

            const x =
              ((Math.max(regionStart, overviewStartVa) - overviewStartVa) /
                rangeSpan) *
              BAR_VIEWBOX_WIDTH;
            const endX =
              ((Math.min(regionEnd, overviewEndVa) - overviewStartVa) /
                rangeSpan) *
              BAR_VIEWBOX_WIDTH;
            const width = Math.max(1, endX - x);

            return (
              <rect
                key={`${region.startVa}-${region.endVa}`}
                className={regionClassName(region)}
                x={x}
                y={0}
                width={width}
                height={BAR_HEIGHT}
              >
                <title>{formatRegionTitle(region)}</title>
              </rect>
            );
          })}
          {markerX !== null ? (
            <line
              className="memory-overview-viewport"
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

function regionClassName(
  region: MethodResult["module.getMemoryOverview"]["regions"][number],
) {
  if (!region.mapped) {
    return "memory-overview-region is-unmapped";
  }

  const permissionKey = `${region.readable ? "r" : "-"}${
    region.writable ? "w" : "-"
  }${region.executable ? "x" : "-"}`;
  return `memory-overview-region perm-${permissionKey}${
    region.discoveredInstruction ? " is-discovered" : ""
  }`;
}

function formatRegionTitle(
  region: MethodResult["module.getMemoryOverview"]["regions"][number],
) {
  if (!region.mapped) {
    return `${region.startVa} - ${region.endVa} unmapped`;
  }

  const permissions = `${region.readable ? "r" : "-"}${
    region.writable ? "w" : "-"
  }${region.executable ? "x" : "-"}`;
  const state = region.discoveredInstruction
    ? "discovered instructions"
    : "undiscovered";
  return `${region.startVa} - ${region.endVa} ${permissions} ${state}`;
}

function clampToViewBox(value: number, upperBound: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), upperBound);
}
