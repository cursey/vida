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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, LinearRow } from "../../shared";

vi.mock("@/components/mode-toggle", () => ({
  ModeToggle: () => <div data-testid="mode-toggle" />,
}));

let mockDesktopApi: DesktopApi;

vi.mock("@/platform/desktop-api", () => ({
  get desktopApi() {
    return mockDesktopApi;
  },
}));

function buildRows(): LinearRow[] {
  return [
    {
      kind: "comment",
      address: "0x140001000",
      bytes: "",
      mnemonic: "",
      operands: "",
      text: "",
    },
    {
      kind: "comment",
      address: "0x140001000",
      bytes: "",
      mnemonic: "",
      operands: "",
      text: "sub_140001000",
    },
    {
      kind: "instruction",
      address: "0x140001000",
      bytes: "48 8b 05 39 20 00 00",
      mnemonic: "mov",
      operands: "rax,[rip+0x2039]",
      instructionCategory: "data_transfer",
    },
    {
      kind: "comment",
      address: "0x140001020",
      bytes: "",
      mnemonic: "",
      operands: "",
      text: "",
    },
    {
      kind: "label",
      address: "0x140001020",
      bytes: "",
      mnemonic: "",
      operands: "",
      text: "lbl_140001020",
    },
    {
      kind: "instruction",
      address: "0x140001020",
      bytes: "c3",
      mnemonic: "ret",
      operands: "",
      instructionCategory: "return",
    },
  ];
}

describe("App xrefs modal", () => {
  let menuOpenHandler: (() => void) | null = null;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  function installMockApi(
    getXrefsToVa: DesktopApi["getXrefsToVa"],
    findLinearRowByVa: DesktopApi["findLinearRowByVa"] = vi
      .fn()
      .mockResolvedValue({ rowIndex: 2 }),
  ): DesktopApi {
    const rows = buildRows();

    mockDesktopApi = createMockDesktopApi({
      pickExecutable: vi.fn().mockResolvedValue("C:\\fixtures\\sample.exe"),
      onMenuOpenExecutable: vi.fn((callback: () => void) => {
        menuOpenHandler = callback;
        return () => {};
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
        rowCount: rows.length,
        minVa: "0x140001000",
        maxVa: "0x140001020",
        rowHeight: 24,
        dataGroupSize: 16,
      }),
      getLinearRows: vi.fn().mockResolvedValue({
        rows,
      }),
      findLinearRowByVa,
      getXrefsToVa,
    });

    return mockDesktopApi;
  }

  beforeEach(() => {
    menuOpenHandler = null;
    rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({
        x: 0,
        y: 0,
        width: 960,
        height: 640,
        top: 0,
        left: 0,
        right: 960,
        bottom: 640,
        toJSON: () => ({}),
      }));
  });

  afterEach(() => {
    rectSpy.mockRestore();
  });

  it("opens the xrefs modal for the highlighted VA and navigates on click", async () => {
    const findLinearRowByVa = vi.fn().mockResolvedValue({ rowIndex: 2 });
    const getXrefsToVa = vi.fn().mockResolvedValue({
      targetVa: "0x140001000",
      xrefs: [
        {
          sourceVa: "0x140001234",
          sourceFunctionStartVa: "0x140001200",
          sourceFunctionName: "sub_140001200",
          kind: "call",
          targetVa: "0x140001000",
          targetKind: "code",
        },
      ],
    });
    installMockApi(getXrefsToVa, findLinearRowByVa);

    render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(screen.getByText("Disassembly")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "x", code: "KeyX" });

    await waitFor(() => {
      expect(screen.getByText("Xrefs To 0x140001000")).toBeInTheDocument();
      expect(screen.getByText("sub_140001200")).toBeInTheDocument();
      expect(getXrefsToVa).toHaveBeenCalledWith({
        moduleId: "m1",
        va: "0x140001000",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /sub_140001200/i }));

    await waitFor(() => {
      expect(findLinearRowByVa).toHaveBeenLastCalledWith({
        moduleId: "m1",
        va: "0x140001234",
      });
      expect(
        screen.queryByText("Xrefs To 0x140001000"),
      ).not.toBeInTheDocument();
    });
  });

  it("uses the selected function comment row address when opening xrefs", async () => {
    const getXrefsToVa = vi.fn().mockResolvedValue({
      targetVa: "0x140001000",
      xrefs: [],
    });
    installMockApi(getXrefsToVa, vi.fn().mockResolvedValue({ rowIndex: 1 }));

    render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    fireEvent.keyDown(window, { key: "x", code: "KeyX" });

    await waitFor(() => {
      expect(getXrefsToVa).toHaveBeenCalledWith({
        moduleId: "m1",
        va: "0x140001000",
      });
    });
  });

  it("uses the selected label row address when opening xrefs", async () => {
    const getXrefsToVa = vi.fn().mockResolvedValue({
      targetVa: "0x140001020",
      xrefs: [],
    });
    installMockApi(getXrefsToVa, vi.fn().mockResolvedValue({ rowIndex: 4 }));

    render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(screen.getByText("Disassembly")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "x", code: "KeyX" });

    await waitFor(() => {
      expect(getXrefsToVa).toHaveBeenCalledWith({
        moduleId: "m1",
        va: "0x140001020",
      });
    });
  });

  it("shows a transient status message when the highlighted VA has no xrefs", async () => {
    const getXrefsToVa = vi.fn().mockResolvedValue({
      targetVa: "0x140001000",
      xrefs: [],
    });
    installMockApi(getXrefsToVa);

    render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(screen.getByText("Disassembly")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "x", code: "KeyX" });

    await waitFor(() => {
      expect(
        screen.getByText("No xrefs are available for the highlighted VA."),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Xrefs To 0x140001000"),
      ).not.toBeInTheDocument();
    });
  });

  it("shows an error modal when xrefs loading fails", async () => {
    const getXrefsToVa = vi
      .fn()
      .mockRejectedValue(new Error("The xref index is unavailable"));
    installMockApi(getXrefsToVa);

    render(<App />);

    await waitFor(() => {
      expect(menuOpenHandler).toBeTypeOf("function");
    });

    await act(async () => {
      menuOpenHandler?.();
    });

    await waitFor(() => {
      expect(screen.getByText("Disassembly")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "x", code: "KeyX" });

    await waitFor(() => {
      expect(screen.getByText("Load Xrefs Failed")).toBeInTheDocument();
      expect(
        screen.getByText("The xref index is unavailable"),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Xrefs To 0x140001000"),
      ).not.toBeInTheDocument();
    });
  });
});
