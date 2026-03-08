import { App } from "@/App";
import { createMockDesktopApi } from "@/test-utils/mock-desktop-api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "../../shared";

vi.mock("@/components/mode-toggle", () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
}));

let mockDesktopApi: DesktopApi;

vi.mock("@/platform/desktop-api", () => ({
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

    expect(screen.queryByTestId("memory-overview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("browser-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("disassembly-canvas")).not.toBeInTheDocument();
    expect(screen.getByTestId("workspace-idle-message")).toHaveTextContent(
      "Load a file to begin exploring.",
    );
    expect(
      screen.queryByRole("separator", { name: "Resize browser panel" }),
    ).not.toBeInTheDocument();

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
