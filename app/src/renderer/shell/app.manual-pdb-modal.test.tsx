import { App } from "@/App";
import { createMockDesktopApi } from "@/test-utils/mock-desktop-api";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

describe("App manual PDB modal", () => {
  let menuOpenHandler: (() => void) | null = null;

  function installMockApi(overrides: Partial<DesktopApi> = {}): DesktopApi {
    mockDesktopApi = createMockDesktopApi({
      pickExecutable: vi.fn().mockResolvedValue("C:\\fixtures\\sample.exe"),
      onMenuOpenExecutable: vi.fn((callback: () => void) => {
        menuOpenHandler = callback;
        return () => {};
      }),
      getModulePdbStatus: vi.fn().mockResolvedValue({
        status: "needs_manual",
        embeddedPath: "symbols\\sample.pdb",
      }),
      openModule: vi.fn().mockResolvedValue({
        moduleId: "m1",
        arch: "x64",
        imageBase: "0x140000000",
        entryVa: "0x140001000",
      }),
      getModuleInfo: vi.fn().mockResolvedValue({
        sections: [
          {
            name: ".text",
            startVa: "0x140001000",
            endVa: "0x140002000",
            rawOffset: 0,
            rawSize: 0,
          },
        ],
        imports: [],
        exports: [],
      }),
      listFunctions: vi.fn().mockResolvedValue({
        functions: [
          {
            start: "0x140001000",
            name: "sub_140001000",
            kind: "entry",
          },
        ],
      }),
      getLinearViewInfo: vi.fn().mockResolvedValue({
        rowCount: 0,
        minVa: "0x140001000",
        maxVa: "0x140001000",
        rowHeight: 24,
        dataGroupSize: 16,
      }),
      ...overrides,
    });

    return mockDesktopApi;
  }

  beforeEach(() => {
    menuOpenHandler = null;
  });

  it("lets the user continue loading without a PDB", async () => {
    const api = installMockApi();
    render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(screen.getByText("No Matching PDB Found")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Load Without PDB" }));

    await waitFor(() => {
      expect(api.pickPdb).not.toHaveBeenCalled();
      expect(api.openModule).toHaveBeenCalledWith(
        "C:\\fixtures\\sample.exe",
        undefined,
      );
    });
  });

  it("opens a PDB picker and passes the chosen path into module open", async () => {
    const api = installMockApi({
      pickPdb: vi.fn().mockResolvedValue("C:\\symbols\\sample.pdb"),
    });
    render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(screen.getByText("No Matching PDB Found")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Choose PDB" }));

    await waitFor(() => {
      expect(api.pickPdb).toHaveBeenCalledTimes(1);
      expect(api.openModule).toHaveBeenCalledWith(
        "C:\\fixtures\\sample.exe",
        "C:\\symbols\\sample.pdb",
      );
    });
  });

  it("fails the load when the user cancels manual PDB selection", async () => {
    const api = installMockApi({
      pickPdb: vi.fn().mockResolvedValue(null),
    });
    render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(screen.getByText("No Matching PDB Found")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Choose PDB" }));

    await waitFor(() => {
      expect(api.openModule).not.toHaveBeenCalled();
      expect(
        screen.getByText("Manual PDB selection was canceled."),
      ).toBeInTheDocument();
      expect(screen.getByTestId("workspace-idle-message")).toBeInTheDocument();
    });
  });

  it("surfaces backend mismatch failures after manual PDB selection", async () => {
    const api = installMockApi({
      pickPdb: vi.fn().mockResolvedValue("C:\\symbols\\sample.pdb"),
      openModule: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Invalid PDB: PDB 'C:\\symbols\\sample.pdb' does not match the module debug signature and age",
          ),
        ),
    });
    render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(screen.getByText("No Matching PDB Found")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Choose PDB" }));

    await waitFor(() => {
      expect(api.openModule).toHaveBeenCalledWith(
        "C:\\fixtures\\sample.exe",
        "C:\\symbols\\sample.pdb",
      );
      expect(
        screen.getByText(/does not match the module debug signature and age/i),
      ).toBeInTheDocument();
      expect(screen.getByTestId("workspace-idle-message")).toBeInTheDocument();
    });
  });
});
