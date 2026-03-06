import { Button } from "@/components/ui/button";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { CSSProperties, PointerEvent, RefObject } from "react";
import type { LinearRow } from "../../../shared/protocol";

type DisassemblyColumn = "section" | "address" | "bytes" | "instruction";

type DisassemblyPanelProps = {
  isActive: boolean;
  moduleId: string;
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
  onNavigateToRva: (rva: string) => Promise<boolean>;
};

export function DisassemblyPanel({
  isActive,
  moduleId,
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
  onNavigateToRva,
}: DisassemblyPanelProps) {
  return (
    <section
      className={`panel panel-disassembly ${isActive ? "is-panel-active" : ""}`}
      onPointerDown={onActivate}
      onWheel={onActivate}
      onFocusCapture={onActivate}
    >
      <header className="panel-header">
        <h2>Disassembly</h2>
        <span>{moduleId ? `${rowCount} rows` : ""}</span>
      </header>
      <div className="panel-body table-body" style={disassemblyColumnStyle}>
        <div className="disassembly-columns-header">
          <div className="column-header-cell">
            <span>Section</span>
            <Button
              className="column-resizer"
              size="icon"
              variant="ghost"
              aria-label="Resize Section column"
              onPointerDown={(event) => onStartColumnResizing("section", event)}
            />
          </div>
          <div className="column-header-cell">
            <span>Address</span>
            <Button
              className="column-resizer"
              size="icon"
              variant="ghost"
              aria-label="Resize Address column"
              onPointerDown={(event) => onStartColumnResizing("address", event)}
            />
          </div>
          <div className="column-header-cell">
            <span>Bytes</span>
            <Button
              className="column-resizer"
              size="icon"
              variant="ghost"
              aria-label="Resize Bytes column"
              onPointerDown={(event) => onStartColumnResizing("bytes", event)}
            />
          </div>
          <div className="column-header-cell">
            <span>Instruction</span>
            <Button
              className="column-resizer"
              size="icon"
              variant="ghost"
              aria-label="Resize Instruction column"
              onPointerDown={(event) =>
                onStartColumnResizing("instruction", event)
              }
            />
          </div>
          <div className="column-header-cell">
            <span>Comment</span>
          </div>
        </div>

        <div className="disassembly-scroll-region" ref={disassemblyScrollRef}>
          <div
            className="disassembly-rows-canvas"
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
                    className="disassembly-row row-loading"
                    style={{ transform: `translateY(${top}px)` }}
                  >
                    <div className="cell section-cell" />
                    <div className="cell">
                      <code>...</code>
                    </div>
                    <div className="cell">
                      <code>...</code>
                    </div>
                    <div className="cell">loading</div>
                    <div className="cell" />
                  </div>
                );
              }

              return (
                <div
                  key={`${logicalRowIndex}-${cacheEpoch}-${row.address}`}
                  className={`disassembly-row kind-${row.kind} ${
                    selectedRowIndex === logicalRowIndex ? "is-current" : ""
                  }`}
                  style={{ transform: `translateY(${top}px)` }}
                  onPointerDown={(event) => {
                    if (event.button !== 0) {
                      return;
                    }
                    onSelectRow(logicalRowIndex, row.address);
                  }}
                >
                  <div className="cell section-cell">
                    {findSectionName(row.address)}
                  </div>
                  <div className="cell">
                    <code>{row.address}</code>
                  </div>
                  <div className="cell">
                    <code>{row.bytes}</code>
                  </div>
                  <div className="cell">
                    <span
                      className={`mnemonic mnemonic-${
                        row.instructionCategory ?? "other"
                      }`}
                    >
                      {row.mnemonic}
                    </span>
                    {row.operands ? (
                      <span className="operands">{row.operands}</span>
                    ) : null}
                  </div>
                  <div className="cell comment-cell">
                    {row.comment ? <span>{`; ${row.comment}`}</span> : null}
                    {row.branchTarget ? (
                      <a
                        className="comment-link"
                        href={`#${row.branchTarget}`}
                        onClick={(event) => {
                          event.preventDefault();
                          void onNavigateToRva(row.branchTarget ?? "");
                        }}
                      >
                        ; branch -&gt; {row.branchTarget}
                      </a>
                    ) : null}
                    {row.callTarget ? (
                      <a
                        className="comment-link"
                        href={`#${row.callTarget}`}
                        onClick={(event) => {
                          event.preventDefault();
                          void onNavigateToRva(row.callTarget ?? "");
                        }}
                      >
                        ; call -&gt; {row.callTarget}
                      </a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
