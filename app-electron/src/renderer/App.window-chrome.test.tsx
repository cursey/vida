import { App } from "@/App";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronApi } from "../shared/protocol";

vi.mock("@/components/mode-toggle", () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
}));

describe("App custom window chrome", () => {
  const invokeTitleBarMenuAction = vi.fn().mockResolvedValue(undefined);
  const windowControl = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    invokeTitleBarMenuAction.mockClear();
    windowControl.mockClear();

    const mockApi: ElectronApi = {
      pickExecutable: vi.fn().mockResolvedValue(null),
      addRecentExecutable: vi.fn().mockResolvedValue(undefined),
      onMenuOpenExecutable: vi.fn(() => () => {}),
      onMenuOpenRecentExecutable: vi.fn(() => () => {}),
      getWindowChromeState: vi.fn().mockResolvedValue({
        useCustomChrome: true,
        platform: "win32",
        isMaximized: false,
        isFocused: true,
      }),
      onWindowChromeStateChanged: vi.fn(() => () => {}),
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
      onTitleBarMenuModelChanged: vi.fn(() => () => {}),
      invokeTitleBarMenuAction,
      pingEngine: vi.fn().mockResolvedValue({ version: "0.1.0" }),
      openModule: vi.fn().mockResolvedValue({
        moduleId: "m1",
        arch: "x64",
        imageBase: "0x140000000",
        entryRva: "0x1000",
      }),
      getModuleInfo: vi.fn().mockResolvedValue({
        sections: [],
        imports: [],
        exports: [],
      }),
      listFunctions: vi.fn().mockResolvedValue({ functions: [] }),
      disassembleLinear: vi.fn().mockResolvedValue({
        instructions: [],
        stopReason: "end_of_data",
      }),
      getLinearViewInfo: vi.fn().mockResolvedValue({
        rowCount: 0,
        minRva: "0x0",
        maxRva: "0x0",
        rowHeight: 24,
        dataGroupSize: 16,
      }),
      getLinearRows: vi.fn().mockResolvedValue({ rows: [] }),
      findLinearRowByRva: vi.fn().mockResolvedValue({ rowIndex: 0 }),
    };

    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: mockApi,
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
