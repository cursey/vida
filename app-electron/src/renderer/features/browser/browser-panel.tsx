import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { RefObject } from "react";
import type { FunctionSeed } from "../../../shared/protocol";
import { toFunctionProvenanceCode } from "./function-provenance";

type BrowserPanelProps = {
  isActive: boolean;
  moduleId: string;
  appliedFunctionSearchQuery: string;
  functionCount: number;
  totalFunctionCount: number;
  functionScrollRef: RefObject<HTMLDivElement | null>;
  functionListTotalSize: number;
  functionVirtualItems: VirtualItem[];
  boundedFunctionWindowStart: number;
  displayedFunctionIndexes: number[] | null;
  functions: FunctionSeed[];
  goToAddress: string;
  onNavigateToRva: (rva: string) => Promise<boolean>;
  isBrowserSearchVisible: boolean;
  browserSearchInputRef: RefObject<HTMLInputElement | null>;
  functionSearchQuery: string;
  onFunctionSearchQueryChange: (value: string) => void;
  onActivate: () => void;
};

export function BrowserPanel({
  isActive,
  moduleId,
  appliedFunctionSearchQuery,
  functionCount,
  totalFunctionCount,
  functionScrollRef,
  functionListTotalSize,
  functionVirtualItems,
  boundedFunctionWindowStart,
  displayedFunctionIndexes,
  functions,
  goToAddress,
  onNavigateToRva,
  isBrowserSearchVisible,
  browserSearchInputRef,
  functionSearchQuery,
  onFunctionSearchQueryChange,
  onActivate,
}: BrowserPanelProps) {
  return (
    <section
      className={`panel panel-nav ${isActive ? "is-panel-active" : ""}`}
      onPointerDown={onActivate}
      onWheel={onActivate}
      onFocusCapture={onActivate}
    >
      <header className="panel-header">
        <h2>Browser</h2>
        <span>
          {moduleId
            ? appliedFunctionSearchQuery
              ? `${functionCount}/${totalFunctionCount} functions`
              : `${totalFunctionCount} functions`
            : ""}
        </span>
      </header>
      <div className="panel-body">
        <div className="function-scroll-region" ref={functionScrollRef}>
          <ul
            className="function-list"
            style={{ height: `${functionListTotalSize}px` }}
          >
            {functionVirtualItems.map((virtualRow) => {
              const logicalFunctionIndex =
                boundedFunctionWindowStart + virtualRow.index;
              const sourceFunctionIndex =
                displayedFunctionIndexes?.[logicalFunctionIndex] ??
                logicalFunctionIndex;
              const func = functions[sourceFunctionIndex];
              if (!func) {
                return null;
              }
              return (
                <li
                  className="function-row"
                  key={`${func.kind}-${func.start}-${sourceFunctionIndex}`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <Button
                    className={cn(
                      "function-link",
                      func.start === goToAddress && "is-active",
                    )}
                    variant="ghost"
                    type="button"
                    onClick={() => void onNavigateToRva(func.start)}
                  >
                    <span
                      className={cn(
                        "function-meta",
                        `function-meta-${func.kind}`,
                      )}
                    >
                      {toFunctionProvenanceCode(func.kind)}
                    </span>
                    <span className="function-name">{func.name}</span>
                    <code>{func.start}</code>
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
        {isBrowserSearchVisible ? (
          <div className="browser-search">
            <Input
              ref={browserSearchInputRef}
              aria-label="Search functions"
              autoComplete="off"
              className="browser-search-input"
              disabled={!moduleId}
              onChange={(event) =>
                onFunctionSearchQueryChange(event.target.value)
              }
              placeholder="Search"
              spellCheck={false}
              type="text"
              value={functionSearchQuery}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
