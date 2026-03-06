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
import { Copy, Minus, Square, X } from "lucide-react";
import type { ReactNode } from "react";
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
        <DropdownMenuSubContent className="titlebar-menu-content app-no-drag">
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
    <header className="window-chrome">
      <div
        className="window-chrome-drag app-drag"
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest(".app-no-drag")) {
            return;
          }
          onWindowControl("toggleMaximize");
        }}
      >
        <div className="window-chrome-left">
          <span className="window-chrome-app-label">Electron Disassembler</span>
          <nav
            aria-label="Application menu"
            className="window-chrome-menubar app-no-drag"
          >
            {menuModel.menus.map((menu) => (
              <DropdownMenu key={menu.id}>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="titlebar-menu-trigger app-no-drag focus-visible:border-transparent focus-visible:ring-0"
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {menu.label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="titlebar-menu-content app-no-drag"
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
        <div className="window-chrome-title">{titleText}</div>
      </div>
      <div className="window-chrome-controls app-no-drag">
        <Button
          aria-label="Minimize window"
          className="titlebar-control-button app-no-drag"
          onClick={() => onWindowControl("minimize")}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Minus />
        </Button>
        <Button
          aria-label={
            windowState.isMaximized ? "Restore window" : "Maximize window"
          }
          className="titlebar-control-button app-no-drag"
          onClick={() => onWindowControl("toggleMaximize")}
          size="icon"
          type="button"
          variant="ghost"
        >
          {windowState.isMaximized ? <Copy /> : <Square />}
        </Button>
        <Button
          aria-label="Close window"
          className="titlebar-control-button titlebar-control-close app-no-drag"
          onClick={() => onWindowControl("close")}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X />
        </Button>
      </div>
    </header>
  );
}
