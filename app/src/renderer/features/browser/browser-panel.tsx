import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  AppPanel,
  AppPanelBody,
  AppPanelHeader,
  AppPanelMeta,
  AppPanelTitle,
} from "@/shell/components/panel";
import type { VirtualItem } from "@tanstack/react-virtual";
import type { RefObject } from "react";
import type { FunctionSeed } from "../../../shared";
import { toFunctionProvenanceCode } from "./function-provenance";

type BrowserPanelProps = {
  isActive: boolean;
  moduleId: string;
  showFunctionCount: boolean;
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
  onNavigateToVa: (va: string) => Promise<boolean>;
  isBrowserSearchVisible: boolean;
  browserSearchInputRef: RefObject<HTMLInputElement | null>;
  functionSearchQuery: string;
  onFunctionSearchQueryChange: (value: string) => void;
  onActivate: () => void;
};

export function BrowserPanel({
  isActive,
  moduleId,
  showFunctionCount,
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
  onNavigateToVa,
  isBrowserSearchVisible,
  browserSearchInputRef,
  functionSearchQuery,
  onFunctionSearchQueryChange,
  onActivate,
}: BrowserPanelProps) {
  return (
    <AppPanel
      className="col-[1]"
      data-testid="browser-panel"
      isActive={isActive}
      onPointerDown={onActivate}
      onWheel={onActivate}
      onFocusCapture={onActivate}
    >
      <AppPanelHeader>
        <AppPanelTitle>Browser</AppPanelTitle>
        <AppPanelMeta>
          {moduleId && showFunctionCount
            ? appliedFunctionSearchQuery
              ? `${functionCount}/${totalFunctionCount} functions`
              : `${totalFunctionCount} functions`
            : ""}
        </AppPanelMeta>
      </AppPanelHeader>
      <AppPanelBody className="flex flex-col overflow-hidden p-0">
        <div
          className="flex-1 min-h-0 overflow-auto overflow-x-hidden overscroll-contain"
          ref={functionScrollRef}
        >
          <ul
            className="relative m-0 min-h-full list-none p-0"
            data-testid="function-list"
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
                  className="absolute left-0 top-0 h-[26px] w-full pb-[2px]"
                  data-testid="function-row"
                  key={`${func.kind}-${func.start}-${sourceFunctionIndex}`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <Button
                    className={cn(
                      "grid h-6 w-full grid-cols-[minmax(34px,max-content)_1fr_auto] justify-start gap-1 rounded-none border-0 px-1.5 text-left text-xs font-normal text-foreground shadow-none",
                      "hover:bg-accent hover:text-foreground",
                      func.start === goToAddress &&
                        "bg-primary/15 shadow-[inset_2px_0_0_oklch(var(--primary))] hover:bg-primary/15",
                    )}
                    variant="ghost"
                    type="button"
                    onClick={() => void onNavigateToVa(func.start)}
                  >
                    <Badge
                      className={cn(
                        "h-3 self-center justify-self-start rounded-full border px-1.5 text-[9px] font-medium lowercase leading-none tracking-[0.01em] shadow-none",
                        func.kind === "entry" &&
                          "border-[oklch(var(--chart-3)/0.45)] bg-[oklch(var(--chart-3)/0.14)] text-[oklch(var(--chart-3))]",
                        func.kind === "export" &&
                          "border-[oklch(var(--chart-2)/0.45)] bg-[oklch(var(--chart-2)/0.14)] text-[oklch(var(--chart-2))]",
                        func.kind === "tls" &&
                          "border-[oklch(var(--chart-1)/0.45)] bg-[oklch(var(--chart-1)/0.14)] text-[oklch(var(--chart-1))]",
                        func.kind === "exception" &&
                          "border-[oklch(var(--chart-5)/0.45)] bg-[oklch(var(--chart-5)/0.14)] text-[oklch(var(--chart-5))]",
                        func.kind === "pdb" &&
                          "border-[oklch(var(--chart-4)/0.45)] bg-[oklch(var(--chart-4)/0.14)] text-[oklch(var(--chart-4))]",
                        func.kind === "call" &&
                          "border-[oklch(var(--chart-2)/0.45)] bg-[oklch(var(--chart-2)/0.14)] text-[oklch(var(--chart-2))]",
                      )}
                      variant="outline"
                    >
                      {toFunctionProvenanceCode(func.kind)}
                    </Badge>
                    <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono">
                      {func.name}
                    </span>
                    <code className="text-[11px] text-muted-foreground">
                      {func.start}
                    </code>
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
        {isBrowserSearchVisible ? (
          <div className="border-t border-input p-1.5">
            <Input
              ref={browserSearchInputRef}
              aria-label="Search functions"
              autoComplete="off"
              className="h-6 rounded-none px-2 text-xs"
              disabled={!moduleId || !showFunctionCount}
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
      </AppPanelBody>
    </AppPanel>
  );
}
