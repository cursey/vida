import { cn } from "@/lib/utils";
import type * as React from "react";

function AppPanel({
  className,
  isActive = false,
  ...props
}: React.ComponentProps<"section"> & {
  isActive?: boolean;
}) {
  return (
    <section
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden border border-border bg-card animate-fade-in-up",
        isActive && "border-ring ring-1 ring-inset ring-ring/35",
        className,
      )}
      {...props}
    />
  );
}

function AppPanelHeader({
  className,
  ...props
}: React.ComponentProps<"header">) {
  return (
    <header
      className={cn(
        "flex h-[30px] items-center justify-between gap-2 border-b border-border bg-secondary px-2",
        className,
      )}
      {...props}
    />
  );
}

function AppPanelTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn("m-0 text-[13px] font-semibold tracking-normal", className)}
      {...props}
    />
  );
}

function AppPanelMeta({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("text-xs text-muted-foreground tabular-nums", className)}
      {...props}
    />
  );
}

function AppPanelBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex-1 min-h-0 overflow-auto overscroll-contain p-1.5",
        className,
      )}
      {...props}
    />
  );
}

export { AppPanel, AppPanelBody, AppPanelHeader, AppPanelMeta, AppPanelTitle };
