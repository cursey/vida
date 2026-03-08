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
import { type FormEvent, type RefObject, useRef } from "react";
import type { XrefRecord } from "../../../shared/protocol";

type LoadingDialogProps = {
  isLoading: boolean;
  loadingPath: string;
};

export function LoadingDialog({ isLoading, loadingPath }: LoadingDialogProps) {
  return (
    <Dialog open={isLoading}>
      <DialogContent
        className="loading-modal"
        overlayClassName="loading-modal-overlay"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="loading-header">
          <div aria-hidden="true" className="loading-spinner" />
          <DialogTitle className="loading-title">Opening File</DialogTitle>
        </DialogHeader>
        <DialogHeader className="loading-copy">
          <DialogDescription className="loading-description">
            Reading the selected file and preparing the workspace. Analysis will
            continue in the background.
          </DialogDescription>
        </DialogHeader>
        <code className="loading-path">{loadingPath}</code>
      </DialogContent>
    </Dialog>
  );
}

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
      <DialogContent className="go-to-modal">
        <DialogHeader>
          <DialogTitle className="go-to-title">Go To Address</DialogTitle>
        </DialogHeader>
        <form
          className="go-to-form"
          onSubmit={(event) => {
            onSubmit(event);
          }}
        >
          <Input
            ref={goToInputRef}
            value={goToInputValue}
            onChange={(event) => onGoToInputChange(event.target.value)}
            placeholder="0x140001000"
          />
          <DialogFooter className="go-to-modal-actions">
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
        className="xrefs-modal"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
        ref={contentRef}
        tabIndex={-1}
      >
        <DialogHeader>
          <DialogTitle className="xrefs-title">Xrefs To {targetVa}</DialogTitle>
          <DialogDescription className="xrefs-description">
            Select an xref to jump to its source in Disassembly.
          </DialogDescription>
        </DialogHeader>
        <ul className="xrefs-list">
          {xrefs.map((xref) => (
            <li key={`${xref.sourceVa}-${xref.kind}-${xref.targetVa}`}>
              <Button
                className="xrefs-item"
                disabled={isLoading}
                onClick={() => onNavigateToXref(xref)}
                size="sm"
                type="button"
                variant="ghost"
              >
                <div className="xrefs-item-line">
                  <code>{xref.sourceVa}</code>
                  <span className="xrefs-function-name">
                    {xref.sourceFunctionName}
                  </span>
                  <code>{xref.sourceFunctionStartVa}</code>
                  <span className={`xrefs-kind kind-${xref.kind}`}>
                    {xref.kind}
                  </span>
                </div>
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter className="xrefs-modal-actions">
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
