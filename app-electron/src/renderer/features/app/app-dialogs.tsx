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
import type { FormEvent, RefObject } from "react";

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
          <DialogTitle className="loading-title">Loading File</DialogTitle>
        </DialogHeader>
        <DialogHeader className="loading-copy">
          <DialogDescription className="loading-description">
            The selected file is being loaded and analyzed. Please wait.
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
