import { parseHexVa } from "@/features/shared/number-utils";
import type { MethodResult } from "../../../shared/protocol";

const BAR_VIEWBOX_WIDTH = 1000;
const BAR_HEIGHT = 18;

type MemoryOverviewBarProps = {
  overview: MethodResult["module.getMemoryOverview"] | null;
  markerVa: number | null;
};

export function MemoryOverviewBar({
  overview,
  markerVa,
}: MemoryOverviewBarProps) {
  if (!overview) {
    return (
      <section className="memory-overview-shell" aria-label="Memory overview">
        <div className="memory-overview-header">
          <span>Memory Layout</span>
          <span>Load an executable to inspect mapped memory.</span>
        </div>
        <div className="memory-overview-empty" />
      </section>
    );
  }

  const startVa = parseHexVa(overview.startVa);
  const endVa = parseHexVa(overview.endVa);
  if (startVa === null || endVa === null || endVa <= startVa) {
    return (
      <section className="memory-overview-shell" aria-label="Memory overview">
        <div className="memory-overview-header">
          <span>Memory Layout</span>
          <code>{overview.startVa}</code>
        </div>
        <div className="memory-overview-empty" />
      </section>
    );
  }

  const rangeSpan = endVa - startVa;

  const markerX =
    markerVa === null
      ? null
      : clampToViewBox(
          ((markerVa - startVa) / rangeSpan) * BAR_VIEWBOX_WIDTH,
          BAR_VIEWBOX_WIDTH,
        );

  return (
    <section className="memory-overview-shell" aria-label="Memory overview">
      <div className="memory-overview-header">
        <span>Memory Layout</span>
        <code>
          {overview.startVa} - {overview.endVa}
        </code>
      </div>
      <svg
        className="memory-overview-bar"
        viewBox={`0 0 ${BAR_VIEWBOX_WIDTH} ${BAR_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Executable memory layout"
      >
        {overview.regions.map((region) => {
          const regionStart = parseHexVa(region.startVa);
          const regionEnd = parseHexVa(region.endVa);
          if (
            regionStart === null ||
            regionEnd === null ||
            regionEnd <= regionStart ||
            regionEnd <= startVa ||
            regionStart >= endVa
          ) {
            return null;
          }

          const x =
            ((Math.max(regionStart, startVa) - startVa) / rangeSpan) *
            BAR_VIEWBOX_WIDTH;
          const endX =
            ((Math.min(regionEnd, endVa) - startVa) / rangeSpan) *
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
    </section>
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
