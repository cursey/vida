import { describe, expect, it, vi } from "vitest";
import { navigateFromDisassemblyOperand } from "./operand-navigation";

describe("navigateFromDisassemblyOperand", () => {
  it("records the source VA before following the target VA", async () => {
    const events: string[] = [];
    const pushSelectionHistory = vi.fn((va: string) => {
      events.push(`push:${va}`);
    });
    const navigateToVa = vi.fn(async (va: string) => {
      events.push(`navigate:${va}`);
      return true;
    });

    const result = await navigateFromDisassemblyOperand(
      "0x140001000",
      "0x140002000",
      pushSelectionHistory,
      navigateToVa,
    );

    expect(result).toBe(true);
    expect(pushSelectionHistory).toHaveBeenCalledWith("0x140001000");
    expect(navigateToVa).toHaveBeenCalledWith("0x140002000");
    expect(events).toEqual(["push:0x140001000", "navigate:0x140002000"]);
  });
});
