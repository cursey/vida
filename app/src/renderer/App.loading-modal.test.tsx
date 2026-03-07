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

describe("App loading modal", () => {
  let menuOpenHandler: (() => void) | null = null;
  let resolveOpenModule: (() => void) | null = null;

  beforeEach(() => {
    menuOpenHandler = null;
    resolveOpenModule = null;

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
      listFunctions: vi.fn().mockResolvedValue({
        functions: [{ start: "0x1000", name: "sub_00001000", kind: "entry" }],
      }),
    });
  });

  it("shows a blocking file loading modal while opening a module", async () => {
    render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(screen.getByText("Opening File")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Reading the selected file and preparing the workspace. Analysis will continue in the background.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("C:\\fixtures\\sample.exe")).toBeInTheDocument();
      expect(document.querySelector(".loading-spinner")).not.toBeNull();
    });

    await act(async () => {
      resolveOpenModule?.();
    });

    await waitFor(() => {
      expect(screen.queryByText("Opening File")).not.toBeInTheDocument();
    });
  });
});
