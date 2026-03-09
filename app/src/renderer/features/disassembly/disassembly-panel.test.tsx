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
