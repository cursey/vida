import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LinearRow } from "../../../shared";
import { DisassemblyPanel } from "./disassembly-panel";

const rows: LinearRow[] = [
  {
    kind: "instruction",
    address: "0x140001000",
    bytes: "E8 FB 0F 00 00",
    mnemonic: "call",
    operands: "target_function",
    instructionCategory: "call",
    callTarget: "0x140002000",
  },
  {
    kind: "instruction",
    address: "0x140001005",
    bytes: "75 09",
    mnemonic: "jne",
    operands: "lbl_140001010",
    instructionCategory: "control_flow",
    branchTarget: "0x140001010",
  },
  {
    kind: "gap",
    address: "0x140001020",
    bytes: "",
    mnemonic: "<gap>",
    operands: "",
    comment: "unmapped to 0x140001040 (32 bytes)",
  },
];

describe("DisassemblyPanel", () => {
  it("shows aliased operands without generated branch or call comments", () => {
    const onNavigateToOperandTarget = vi.fn().mockResolvedValue(true);
    render(
      <DisassemblyPanel
        isActive
        moduleId="m1"
        isReady
        rowCount={rows.length}
        disassemblyColumnStyle={{}}
        onActivate={vi.fn()}
        onStartColumnResizing={vi.fn()}
        disassemblyScrollRef={createRef<HTMLDivElement>()}
        disassemblyListTotalSize={rows.length * 24}
        virtualItems={[
          { key: 0, index: 0, start: 0, end: 24, size: 24, lane: 0 },
          { key: 1, index: 1, start: 24, end: 48, size: 24, lane: 0 },
          { key: 2, index: 2, start: 48, end: 72, size: 24, lane: 0 },
        ]}
        boundedDisassemblyWindowStart={0}
        readRow={(index) => rows[index]}
        cacheEpoch={0}
        selectedRowIndex={null}
        onSelectRow={vi.fn()}
        findSectionName={() => ".text"}
        onNavigateToOperandTarget={onNavigateToOperandTarget}
      />,
    );

    expect(
      screen.getByRole("link", { name: "target_function" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "lbl_140001010" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/branch ->/i)).toBeNull();
    expect(screen.queryByText(/call ->/i)).toBeNull();
    expect(
      screen.getByText("; unmapped to 0x140001040 (32 bytes)"),
    ).toBeInTheDocument();
    expect(onNavigateToOperandTarget).not.toHaveBeenCalled();
  });

  it("renders comment rows with shared section and address cells and only prefixes named rows", () => {
    const onSelectRow = vi.fn();
    const commentRows: LinearRow[] = [
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
        text: "entry_function",
      },
      rows[0],
    ];

    render(
      <DisassemblyPanel
        isActive
        moduleId="m1"
        isReady
        rowCount={commentRows.length}
        disassemblyColumnStyle={{}}
        onActivate={vi.fn()}
        onStartColumnResizing={vi.fn()}
        disassemblyScrollRef={createRef<HTMLDivElement>()}
        disassemblyListTotalSize={commentRows.length * 24}
        virtualItems={[
          { key: 0, index: 0, start: 0, end: 24, size: 24, lane: 0 },
          { key: 1, index: 1, start: 24, end: 48, size: 24, lane: 0 },
          { key: 2, index: 2, start: 48, end: 72, size: 24, lane: 0 },
        ]}
        boundedDisassemblyWindowStart={0}
        readRow={(index) => commentRows[index]}
        cacheEpoch={0}
        selectedRowIndex={null}
        onSelectRow={onSelectRow}
        findSectionName={() => ".text"}
        onNavigateToOperandTarget={vi.fn().mockResolvedValue(true)}
      />,
    );

    expect(screen.queryByText(/^;$/)).toBeNull();
    expect(screen.getByText("; entry_function")).toBeInTheDocument();
    expect(screen.getAllByText("0x140001000")).toHaveLength(3);
    expect(screen.getAllByText(".text")).toHaveLength(3);

    fireEvent.pointerDown(screen.getByText("; entry_function"));

    expect(onSelectRow).toHaveBeenCalledWith(1, "0x140001000");
  });

  it("renders label rows with a blank spacer, colored text, and indented instructions", () => {
    const onSelectRow = vi.fn();
    const annotationRows: LinearRow[] = [
      {
        kind: "comment",
        address: "0x140001000",
        bytes: "",
        mnemonic: "",
        operands: "",
        text: "entry_function",
      },
      {
        kind: "comment",
        address: "0x140001010",
        bytes: "",
        mnemonic: "",
        operands: "",
        text: "",
      },
      {
        kind: "label",
        address: "0x140001010",
        bytes: "",
        mnemonic: "",
        operands: "",
        text: "lbl_140001010",
      },
      {
        kind: "instruction",
        address: "0x140001010",
        bytes: "C3",
        mnemonic: "ret",
        operands: "",
        instructionCategory: "return",
      },
    ];

    render(
      <DisassemblyPanel
        isActive
        moduleId="m1"
        isReady
        rowCount={annotationRows.length}
        disassemblyColumnStyle={{}}
        onActivate={vi.fn()}
        onStartColumnResizing={vi.fn()}
        disassemblyScrollRef={createRef<HTMLDivElement>()}
        disassemblyListTotalSize={annotationRows.length * 24}
        virtualItems={[
          { key: 0, index: 0, start: 0, end: 24, size: 24, lane: 0 },
          { key: 1, index: 1, start: 24, end: 48, size: 24, lane: 0 },
          { key: 2, index: 2, start: 48, end: 72, size: 24, lane: 0 },
          { key: 3, index: 3, start: 72, end: 96, size: 24, lane: 0 },
        ]}
        boundedDisassemblyWindowStart={0}
        readRow={(index) => annotationRows[index]}
        cacheEpoch={0}
        selectedRowIndex={null}
        onSelectRow={onSelectRow}
        findSectionName={() => ".text"}
        onNavigateToOperandTarget={vi.fn().mockResolvedValue(true)}
      />,
    );

    const commentRow = screen
      .getByText("; entry_function")
      .closest("[data-row-kind='comment']");
    const spacerRow = document.querySelector(
      "[data-row-kind='comment'][data-address='0x140001010']",
    );
    const labelRows = document.querySelectorAll(
      "[data-row-kind='label'][data-address='0x140001010']",
    );
    const labelText = screen.getByText("lbl_140001010:");
    const labelRow = labelText.closest("[data-row-kind='label']");
    const instructionRow = screen
      .getByText("ret")
      .closest("[data-row-kind='instruction']");
    const instructionCell = instructionRow?.querySelector("div:nth-child(4)");

    expect(commentRow).toHaveClass("italic");
    expect(spacerRow).not.toBeNull();
    expect(labelRow).not.toHaveClass("font-semibold", "text-primary", "italic");
    expect(labelText).toHaveClass("text-primary");
    expect(labelRows).toHaveLength(1);
    expect(screen.getAllByText("0x140001010")).toHaveLength(3);
    expect(screen.getAllByText(".text")).toHaveLength(4);
    expect(instructionCell).toHaveClass("pl-[4ch]");

    fireEvent.pointerDown(labelText);

    expect(onSelectRow).toHaveBeenCalledWith(2, "0x140001010");
  });

  it("follows operand links without selecting the current row", () => {
    const onNavigateToOperandTarget = vi.fn().mockResolvedValue(true);
    const onSelectRow = vi.fn();

    render(
      <DisassemblyPanel
        isActive
        moduleId="m1"
        isReady
        rowCount={rows.length}
        disassemblyColumnStyle={{}}
        onActivate={vi.fn()}
        onStartColumnResizing={vi.fn()}
        disassemblyScrollRef={createRef<HTMLDivElement>()}
        disassemblyListTotalSize={rows.length * 24}
        virtualItems={[
          { key: 0, index: 0, start: 0, end: 24, size: 24, lane: 0 },
          { key: 1, index: 1, start: 24, end: 48, size: 24, lane: 0 },
          { key: 2, index: 2, start: 48, end: 72, size: 24, lane: 0 },
        ]}
        boundedDisassemblyWindowStart={0}
        readRow={(index) => rows[index]}
        cacheEpoch={0}
        selectedRowIndex={null}
        onSelectRow={onSelectRow}
        findSectionName={() => ".text"}
        onNavigateToOperandTarget={onNavigateToOperandTarget}
      />,
    );

    const operandLink = screen.getByRole("link", { name: "target_function" });
    fireEvent.pointerDown(operandLink);
    fireEvent.click(operandLink);

    expect(onSelectRow).not.toHaveBeenCalled();
    expect(onNavigateToOperandTarget).toHaveBeenCalledWith(
      "0x140001000",
      "0x140002000",
    );
  });
});
