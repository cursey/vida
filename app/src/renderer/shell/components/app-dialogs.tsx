import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { type FormEvent, type RefObject, useRef } from "react";
import type { XrefRecord } from "../../../shared";

type GoToDialogProps = {
  isOpen: boolean;
  isLoading: boolean;
  moduleId: string;
  goToInputRef: RefObject<HTMLInputElement | null>;
  goToInputValue: string;
  onGoToInputChange: (value: string) => void;
  onOpenChange: (nextOpen: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

type MissingPdbDialogProps = {
  embeddedPath?: string;
  isOpen: boolean;
  modulePath: string;
  onChoosePdb: () => void;
  onLoadWithoutPdb: () => void;
  onOpenChange: (nextOpen: boolean) => void;
};

type ErrorDialogProps = {
  isOpen: boolean;
  message: string;
  title: string;
  onOpenChange: (nextOpen: boolean) => void;
};

export function GoToDialog({
  isOpen,
  isLoading,
  moduleId,
  goToInputRef,
  goToInputValue,
  onGoToInputChange,
  onOpenChange,
  onSubmit,
}: GoToDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent className="w-[min(420px,calc(100vw-32px))] gap-2.5 p-3">
        <DialogHeader>
          <DialogTitle className="text-[13px] font-semibold">
            Go To Address
          </DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-2.5"
          onSubmit={(event) => {
            onSubmit(event);
          }}
        >
          <Input
            className="font-mono"
            ref={goToInputRef}
            value={goToInputValue}
            onChange={(event) => onGoToInputChange(event.target.value)}
            placeholder="0x140001000"
          />
          <DialogFooter className="mt-0 justify-end gap-1.5 sm:space-x-0">
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!moduleId || isLoading}>
              Jump
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ErrorDialog({
  isOpen,
  message,
  title,
  onOpenChange,
}: ErrorDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent className="w-[min(560px,calc(100vw-32px))] gap-2.5 p-3">
        <DialogHeader>
          <DialogTitle className="text-[13px] font-semibold">
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs leading-5">
            The operation failed with the following details.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[min(40vh,320px)] overflow-y-auto rounded-md border border-input bg-muted/35 px-3 py-2">
          <pre className="m-0 whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-foreground">
            {message}
          </pre>
        </div>
        <DialogFooter className="mt-0 justify-end gap-1.5 sm:space-x-0">
          <Button onClick={() => onOpenChange(false)} type="button">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MissingPdbDialog({
  embeddedPath,
  isOpen,
  modulePath,
  onChoosePdb,
  onLoadWithoutPdb,
  onOpenChange,
}: MissingPdbDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent className="w-[min(460px,calc(100vw-32px))] gap-2.5 p-3">
        <DialogHeader>
          <DialogTitle className="text-[13px] font-semibold">
            No Matching PDB Found
          </DialogTitle>
          <DialogDescription className="text-xs leading-5">
            No matching PDB was found automatically for{" "}
            <span className="font-mono text-foreground">{modulePath}</span>. If
            you want symbols, choose a PDB manually. It must match the module
            debug signature and age.
          </DialogDescription>
          {embeddedPath ? (
            <DialogDescription className="text-xs leading-5">
              Embedded PDB path:{" "}
              <span className="font-mono text-foreground">{embeddedPath}</span>
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter className="mt-0 justify-end gap-1.5 sm:space-x-0">
          <Button onClick={onLoadWithoutPdb} type="button" variant="outline">
            Load Without PDB
          </Button>
          <Button onClick={onChoosePdb} type="button">
            Choose PDB
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type XrefsDialogProps = {
  isOpen: boolean;
  isLoading: boolean;
  targetVa: string;
  xrefs: XrefRecord[];
  onOpenChange: (nextOpen: boolean) => void;
  onNavigateToXref: (xref: XrefRecord) => void;
};

export function XrefsDialog({
  isOpen,
  isLoading,
  targetVa,
  xrefs,
  onOpenChange,
  onNavigateToXref,
}: XrefsDialogProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);

  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent
        className="w-[min(560px,calc(100vw-32px))] gap-2.5 p-3"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
        ref={contentRef}
        tabIndex={-1}
      >
        <DialogHeader>
          <DialogTitle className="text-[13px] font-semibold">
            Xrefs To {targetVa}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Select an xref to jump to its source in Disassembly.
          </DialogDescription>
        </DialogHeader>
        <ul className="m-0 flex max-h-[min(52vh,420px)] list-none flex-col overflow-y-auto border-t border-input p-0">
          {xrefs.map((xref) => (
            <li
              className="border-b border-input"
              key={`${xref.sourceVa}-${xref.kind}-${xref.targetVa}`}
            >
              <Button
                className="block w-full min-w-0 justify-start rounded-none border-0 bg-transparent px-2 text-left text-foreground shadow-none transition-colors hover:bg-accent focus-visible:bg-accent"
                disabled={isLoading}
                onClick={() => onNavigateToXref(xref)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <div className="flex w-full min-w-0 items-center gap-2.5">
                  <code className="shrink-0 text-[11px] text-muted-foreground">
                    {xref.sourceVa}
                  </code>
                  <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs">
                    {xref.sourceFunctionName}
                  </span>
                  <code className="shrink-0 text-[11px] text-muted-foreground">
                    {xref.sourceFunctionStartVa}
                  </code>
                  <span
                    className={cn(
                      "inline-flex h-[18px] min-w-[52px] shrink-0 items-center justify-center rounded-full border border-border bg-secondary px-[7px] text-[10px] lowercase leading-none text-foreground/72",
                      xref.kind === "call" &&
                        "border-[oklch(var(--chart-2)/0.45)] text-[oklch(var(--chart-2))]",
                      (xref.kind === "jump" || xref.kind === "branch") &&
                        "border-[oklch(var(--chart-3)/0.45)] text-[oklch(var(--chart-3))]",
                      xref.kind === "data" &&
                        "border-[oklch(var(--chart-5)/0.45)] text-[oklch(var(--chart-5))]",
                    )}
                  >
                    {xref.kind}
                  </span>
                </div>
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter className="mt-0 justify-end gap-1.5 sm:space-x-0">
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
