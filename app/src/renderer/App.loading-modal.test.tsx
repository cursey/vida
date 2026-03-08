import { App } from "@/App";
import { createMockDesktopApi } from "@/test/mock-desktop-api";
import { act, render, screen, waitFor } from "@testing-library/react";
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

describe("App loading workspace spinner", () => {
  let menuOpenHandler: (() => void) | null = null;
  let resolveOpenModule: (() => void) | null = null;
  let resolveAnalysisStatus:
    | ((
        value: Awaited<ReturnType<DesktopApi["getModuleAnalysisStatus"]>>,
      ) => void)
    | null = null;

  beforeEach(() => {
    menuOpenHandler = null;
    resolveOpenModule = null;
    resolveAnalysisStatus = null;

    const pendingAnalysisStatus = new Promise<
      Awaited<ReturnType<DesktopApi["getModuleAnalysisStatus"]>>
    >((resolve) => {
      resolveAnalysisStatus = resolve;
    });

    mockDesktopApi = createMockDesktopApi({
      pickExecutable: vi.fn().mockResolvedValue("C:\\fixtures\\sample.exe"),
      onMenuOpenExecutable: vi.fn((callback: () => void) => {
        menuOpenHandler = callback;
        return () => {};
      }),
      openModule: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveOpenModule = () =>
              resolve({
                moduleId: "m1",
                arch: "x64",
                imageBase: "0x140000000",
                entryVa: "0x1000",
              });
          }),
      ),
      getModuleAnalysisStatus: vi
        .fn()
        .mockImplementationOnce(async () => pendingAnalysisStatus),
      listFunctions: vi.fn().mockResolvedValue({
        functions: [{ start: "0x1000", name: "sub_00001000", kind: "entry" }],
      }),
    });
  });

  it("shows the workspace spinner while opening a module", async () => {
    render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("workspace-loading-spinner"),
      ).toBeInTheDocument();
    });

    await act(async () => {
      resolveOpenModule?.();
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("workspace-loading-spinner"),
      ).toBeInTheDocument();
    });

    await act(async () => {
      resolveAnalysisStatus?.({
        state: "ready",
        message: "Analysis ready.",
        discoveredFunctionCount: 1,
        totalFunctionCount: 1,
        analyzedFunctionCount: 1,
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("workspace-loading-spinner")).toBeNull();
    });
  });
});
