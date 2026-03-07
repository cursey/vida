import { App } from "@/App";
import { createMockDesktopApi } from "@/test/mock-desktop-api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "../shared/protocol";

vi.mock("@/components/mode-toggle", () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
}));

let mockDesktopApi: DesktopApi;

vi.mock("@/desktop-api", () => ({
  get desktopApi() {
    return mockDesktopApi;
  },
}));

describe("App custom window chrome", () => {
  const invokeTitleBarMenuAction = vi.fn().mockResolvedValue(undefined);
  const windowControl = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    invokeTitleBarMenuAction.mockClear();
    windowControl.mockClear();

    mockDesktopApi = createMockDesktopApi({
      windowControl,
      getTitleBarMenuModel: vi.fn().mockResolvedValue({
        menus: [
          {
            id: "file",
            label: "File",
            items: [
              {
                type: "item",
                label: "Open...",
                enabled: true,
                commandId: "file.open",
                accelerator: "CmdOrCtrl+O",
              },
            ],
          },
        ],
      }),
      invokeTitleBarMenuAction,
    });
  });

  it("renders title bar menus and window controls", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText("Application menu")).toBeInTheDocument();
    });

    fireEvent.pointerDown(screen.getByRole("button", { name: "File" }));
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: /^Open\.\.\./,
        hidden: true,
      }),
    );
    await waitFor(() => {
      expect(invokeTitleBarMenuAction).toHaveBeenCalledWith("file.open");
    });

    fireEvent.click(screen.getByLabelText("Minimize window"));
    await waitFor(() => {
      expect(windowControl).toHaveBeenCalledWith("minimize");
    });
  });
});
