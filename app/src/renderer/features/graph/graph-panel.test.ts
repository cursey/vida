import { describe, expect, it } from "vitest";
import { renderGraphNodeHtml } from "./graph-panel";

describe("renderGraphNodeHtml", () => {
  it("renders mnemonic and operands as distinct listing columns", () => {
    const html = renderGraphNodeHtml({
      id: "b_1000",
      startVa: "0x140001000",
      width: 320,
      height: 120,
      instructions: [
        {
          mnemonic: "push",
          operands: "rbp",
          instructionCategory: "stack",
        },
        {
          mnemonic: "mov",
          operands: "rbp, rsp",
          instructionCategory: "data_transfer",
        },
      ],
    } as Parameters<typeof renderGraphNodeHtml>[0]);

    expect(html).toContain('class="graph-node-header">0x140001000</div>');
    expect(html).toContain(
      '<span class="mnemonic mnemonic-stack">push</span><span class="operands">rbp</span>',
    );
    expect(html).toContain(
      '<span class="mnemonic mnemonic-data_transfer">mov</span><span class="operands">rbp, rsp</span>',
    );
  });
});
