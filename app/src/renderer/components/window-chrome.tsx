import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Copy, Minus, Square, X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import type {
  TitleBarMenuItem,
  TitleBarMenuModel,
  WindowChromeState,
  WindowControlAction,
} from "../../shared/protocol";

type WindowChromeProps = {
  titleText: string;
  menuModel: TitleBarMenuModel;
  windowState: WindowChromeState;
  onWindowControl: (action: WindowControlAction) => void;
  onInvokeMenuAction: (commandId: string) => void;
};

const menuContentClassName =
  "app-no-drag min-w-[210px] border-[oklch(var(--foreground)/0.14)]";

const menuTriggerClassName =
  "app-no-drag h-6 min-w-[42px] rounded-sm border-0 bg-transparent px-2.5 text-xs font-medium text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground focus-visible:border-transparent focus-visible:ring-0 data-[state=open]:bg-transparent";

const windowControlButtonClassName =
  "app-no-drag h-8 w-11 rounded-none border-0 text-muted-foreground shadow-none hover:text-foreground";

function WindowControlButton({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(windowControlButtonClassName, className)}
      size="icon"
      type="button"
      variant="ghost"
      {...props}
    />
  );
}

function renderMenuItem(
  item: TitleBarMenuItem,
  key: string,
  onInvokeMenuAction: (commandId: string) => void,
): ReactNode {
  if (item.type === "separator") {
    return <DropdownMenuSeparator key={key} />;
  }

  if (item.type === "submenu") {
    return (
      <DropdownMenuSub key={key}>
        <DropdownMenuSubTrigger disabled={!item.enabled}>
          {item.label}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className={menuContentClassName}>
          {item.items.map((child, childIndex) =>
            renderMenuItem(
              child,
              `${key}-child-${childIndex}`,
              onInvokeMenuAction,
            ),
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  return (
    <DropdownMenuItem
      key={key}
      disabled={!item.enabled || !item.commandId}
      onClick={() => {
        if (!item.commandId) {
          return;
        }
        onInvokeMenuAction(item.commandId);
      }}
    >
      <span>{item.label}</span>
      {item.accelerator ? (
        <DropdownMenuShortcut>{item.accelerator}</DropdownMenuShortcut>
      ) : null}
    </DropdownMenuItem>
  );
}

export function WindowChrome({
  titleText,
  menuModel,
  windowState,
  onWindowControl,
  onInvokeMenuAction,
}: WindowChromeProps) {
  return (
    <header className="-mx-2 mt-[-8px] flex h-[34px] min-h-[34px] items-stretch overflow-hidden border-0 border-b border-border bg-secondary">
      <div
        className="app-drag flex min-w-0 flex-1 items-center gap-2.5 pr-1.5"
        data-tauri-drag-region
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest(".app-no-drag")) {
            return;
          }
          onWindowControl("toggleMaximize");
        }}
      >
        <div className="flex min-w-0 items-center gap-0 self-stretch">
          <span
            aria-label="ViDA Pro"
            className="relative inline-flex select-none items-center self-stretch whitespace-nowrap border-r border-input bg-card px-2.5 text-[11px] font-bold text-muted-foreground"
            data-tauri-drag-region
          >
            <span className="relative z-[1]">V</span>
            <span
              aria-hidden="true"
              className="relative z-0 -mx-[0.1em] ml-[-0.02em] inline-block translate-x-[-0.09em] translate-y-[0.01em] leading-none text-[hsl(188_100%_78%_/_0.95)] [text-shadow:0_0_4px_hsl(188_100%_82%_/_0.95),0_0_9px_hsl(194_100%_76%_/_0.8),0_0_14px_hsl(202_100%_72%_/_0.55)]"
            >
              .
            </span>
            <span className="relative z-[1]">ıDA Pro</span>
          </span>
          <nav
            aria-label="Application menu"
            className="app-no-drag flex items-center gap-px self-stretch pl-1.5"
          >
            {menuModel.menus.map((menu) => (
              <DropdownMenu key={menu.id}>
                <DropdownMenuTrigger asChild>
                  <Button
                    className={menuTriggerClassName}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {menu.label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className={menuContentClassName}
                >
                  {menu.items.map((item, index) =>
                    renderMenuItem(
                      item,
                      `${menu.id}-item-${index}`,
                      onInvokeMenuAction,
                    ),
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
          </nav>
        </div>
        <div
          className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-center text-xs text-foreground/72"
          data-tauri-drag-region
        >
          {titleText}
        </div>
      </div>
      <div className="app-no-drag flex items-center border-l border-input">
        <WindowControlButton
          aria-label="Minimize window"
          onClick={() => onWindowControl("minimize")}
        >
          <Minus />
        </WindowControlButton>
        <WindowControlButton
          aria-label={
            windowState.isMaximized ? "Restore window" : "Maximize window"
          }
          onClick={() => onWindowControl("toggleMaximize")}
        >
          {windowState.isMaximized ? <Copy /> : <Square />}
        </WindowControlButton>
        <WindowControlButton
          aria-label="Close window"
          className="hover:bg-destructive/90 hover:text-destructive-foreground"
          onClick={() => onWindowControl("close")}
        >
          <X />
        </WindowControlButton>
      </div>
    </header>
  );
}
