import { describe, expect, it } from "vitest";
import { toFunctionProvenanceCode } from "./App";

describe("function provenance shortcodes", () => {
  it("maps known kinds to stable 3-letter codes", () => {
    expect(toFunctionProvenanceCode("pdb")).toBe("pdb");
    expect(toFunctionProvenanceCode("exception")).toBe("exc");
    expect(toFunctionProvenanceCode("import")).toBe("imp");
    expect(toFunctionProvenanceCode("export")).toBe("exp");
    expect(toFunctionProvenanceCode("tls")).toBe("tls");
    expect(toFunctionProvenanceCode("entry")).toBe("ent");
    expect(toFunctionProvenanceCode("call")).toBe("jmp");
  });

  it("falls back to the first three lowercase characters for unknown kinds", () => {
    expect(toFunctionProvenanceCode("Thunk")).toBe("thu");
    expect(toFunctionProvenanceCode("x")).toBe("x");
  });
});
