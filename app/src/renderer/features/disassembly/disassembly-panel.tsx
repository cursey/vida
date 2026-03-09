import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AppPanel,
  AppPanelBody,
  AppPanelHeader,
  AppPanelMeta,
  AppPanelTitle,
} from "@/shell/components/panel";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { CSSProperties, PointerEvent, RefObject } from "react";
import type { InstructionCategory, LinearRow } from "../../../shared";

type DisassemblyColumn = "section" | "address" | "bytes" | "instruction";

const DISASSEMBLY_COLUMNS =
  "var(--col-section-width, 88px) var(--col-address-width, 110px) var(--col-bytes-width, 180px) var(--col-instruction-width, 420px) minmax(var(--col-comment-min-width, 180px), 1fr)";

const cellClassName =
  "flex h-full items-center overflow-hidden px-2 text-ellipsis whitespace-nowrap";

const mnemonicClassNames: Record<InstructionCategory | "other", string> = {
  call: "[color:var(--mnemonic-call)]",
  return: "[color:var(--mnemonic-return)]",
  control_flow: "[color:var(--mnemonic-control-flow)]",
  system: "[color:var(--mnemonic-system)]",
  stack: "[color:var(--mnemonic-stack)]",
  string: "[color:var(--mnemonic-string)]",
  compare_test: "[color:var(--mnemonic-compare-test)]",
  arithmetic: "[color:var(--mnemonic-arithmetic)]",
  logic: "[color:var(--mnemonic-logic)]",
  bit_shift: "[color:var(--mnemonic-bit-shift)]",
  data_transfer: "[color:var(--mnemonic-data-transfer)]",
  other: "text-foreground",
};

function columnHeaderCell(
  label: string,
  resizeLabel?: string,
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void,
) {
  return (
    <div className="relative flex h-full items-center border-r border-input px-[8px] pr-[10px] last:border-r-0">
      <span>{label}</span>
      {resizeLabel && onPointerDown ? (
        <Button
          aria-label={resizeLabel}
          className="absolute right-0 top-0 h-full w-2 min-w-0 translate-x-1/2 cursor-col-resize rounded-none border-0 bg-transparent p-0 hover:bg-transparent focus-visible:bg-transparent"
          onPointerDown={onPointerDown}
          size="icon"
          type="button"
          variant="ghost"
        />
      ) : null}
    </div>
  );
}

type DisassemblyPanelProps = {
  isActive: boolean;
  moduleId: string;
  isReady: boolean;
  rowCount: number;
  disassemblyColumnStyle: CSSProperties;
  onActivate: () => void;
  onStartColumnResizing: (
    key: DisassemblyColumn,
    event: PointerEvent<HTMLButtonElement>,
  ) => void;
  disassemblyScrollRef: RefObject<HTMLDivElement | null>;
  disassemblyListTotalSize: number;
  virtualItems: VirtualItem[];
  boundedDisassemblyWindowStart: number;
  readRow: (index: number) => LinearRow | undefined;
  cacheEpoch: number;
  selectedRowIndex: number | null;
  onSelectRow: (rowIndex: number, address: string) => void;
  findSectionName: (address: string) => string;
  onNavigateToOperandTarget: (
    sourceVa: string,
    targetVa: string,
  ) => Promise<boolean>;
};

function operandTargetForRow(row: LinearRow): string | null {
  if (row.kind !== "instruction" || !row.operands) {
    return null;
  }

  return row.callTarget ?? row.branchTarget ?? null;
}

export function DisassemblyPanel({
  isActive,
  moduleId,
  isReady,
  rowCount,
  disassemblyColumnStyle,
  onActivate,
  onStartColumnResizing,
  disassemblyScrollRef,
  disassemblyListTotalSize,
  virtualItems,
  boundedDisassemblyWindowStart,
  readRow,
  cacheEpoch,
  selectedRowIndex,
  onSelectRow,
  findSectionName,
  onNavigateToOperandTarget,
}: DisassemblyPanelProps) {
  return (
    <AppPanel
      className="panel-disassembly col-[3]"
      isActive={isActive}
      onPointerDown={onActivate}
      onWheel={onActivate}
      onFocusCapture={onActivate}
    >
      <AppPanelHeader>
        <AppPanelTitle>Disassembly</AppPanelTitle>
        <AppPanelMeta>
          {moduleId && isReady ? `${rowCount} rows` : ""}
        </AppPanelMeta>
      </AppPanelHeader>
      {!isReady && moduleId ? (
        <AppPanelBody className="flex items-center justify-center p-0" />
      ) : (
        <AppPanelBody
          className="panel-body flex min-h-0 flex-col overflow-hidden p-0 font-mono"
          style={{
            ...disassemblyColumnStyle,
            ["--disassembly-columns" as string]: DISASSEMBLY_COLUMNS,
          }}
        >
          <div
            className="grid h-6 text-[11px] font-medium text-muted-foreground border-b border-input bg-secondary"
            style={{ gridTemplateColumns: "var(--disassembly-columns)" }}
          >
            {columnHeaderCell("Section", "Resize Section column", (event) =>
              onStartColumnResizing("section", event),
            )}
            {columnHeaderCell("Address", "Resize Address column", (event) =>
              onStartColumnResizing("address", event),
            )}
            {columnHeaderCell("Bytes", "Resize Bytes column", (event) =>
              onStartColumnResizing("bytes", event),
            )}
            {columnHeaderCell(
              "Instruction",
              "Resize Instruction column",
              (event) => onStartColumnResizing("instruction", event),
            )}
            {columnHeaderCell("Comment")}
          </div>

          <div
            className="relative flex-1 min-h-0 overflow-auto"
            ref={disassemblyScrollRef}
          >
            <div
              className="relative min-w-max"
              data-testid="disassembly-canvas"
              style={{ height: `${disassemblyListTotalSize}px` }}
            >
              {virtualItems.map((virtualRow) => {
                const logicalRowIndex =
                  boundedDisassemblyWindowStart + virtualRow.index;
                const row = readRow(logicalRowIndex);
                const top = virtualRow.start;

                if (!row) {
                  return (
                    <div
                      key={`loading-${logicalRowIndex}`}
                      className="absolute left-0 grid h-[var(--cell-height)] w-full items-center text-xs text-muted-foreground"
                      style={{
                        transform: `translateY(${top}px)`,
                        gridTemplateColumns: "var(--disassembly-columns)",
                      }}
                    >
                      <div
                        className={cn(cellClassName, "text-muted-foreground")}
                      />
                      <div className={cellClassName}>
                        <code>...</code>
                      </div>
                      <div className={cellClassName}>
                        <code>...</code>
                      </div>
                      <div className={cellClassName}>loading</div>
                      <div className={cellClassName} />
                    </div>
                  );
                }

                const operandTarget = operandTargetForRow(row);

                return (
                  <div
                    key={`${logicalRowIndex}-${cacheEpoch}-${row.address}`}
                    className={cn(
                      "absolute left-0 grid h-[var(--cell-height)] w-full items-center text-xs hover:bg-accent",
                      row.kind === "gap" &&
                        "bg-secondary/45 text-secondary-foreground italic",
                      selectedRowIndex === logicalRowIndex &&
                        "bg-primary/16 shadow-[inset_0_0_0_1px_oklch(var(--primary)/0.35)] hover:bg-primary/16",
                    )}
                    style={{
                      transform: `translateY(${top}px)`,
                      gridTemplateColumns: "var(--disassembly-columns)",
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0) {
                        return;
                      }
                      onSelectRow(logicalRowIndex, row.address);
                    }}
                  >
                    <div className={cn(cellClassName, "text-muted-foreground")}>
                      {findSectionName(row.address)}
                    </div>
                    <div className={cellClassName}>
                      <code>{row.address}</code>
                    </div>
                    <div className={cellClassName}>
                      <code>{row.bytes}</code>
                    </div>
                    <div className={cellClassName}>
                      <span
                        className={
                          mnemonicClassNames[row.instructionCategory ?? "other"]
                        }
                      >
                        {row.mnemonic}
                      </span>
                      {row.operands ? (
                        operandTarget ? (
                          <a
                            className="ml-[1ch] min-w-0 truncate cursor-pointer text-primary underline decoration-primary/45 underline-offset-2 hover:decoration-primary focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring focus-visible:outline-offset-1"
                            href={`#${operandTarget}`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void onNavigateToOperandTarget(
                                row.address,
                                operandTarget,
                              );
                            }}
                            onPointerDown={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            {row.operands}
                          </a>
                        ) : (
                          <span className="ml-[1ch]">{row.operands}</span>
                        )
                      ) : null}
                    </div>
                    <div className={cn(cellClassName, "text-muted-foreground")}>
                      {row.comment ? <span>{`; ${row.comment}`}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </AppPanelBody>
      )}
    </AppPanel>
  );
}
