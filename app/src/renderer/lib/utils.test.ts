import { cn, getErrorMessage } from "@/lib/utils";
import { describe, expect, it } from "vitest";

describe("cn", () => {
  it("merges utility classes with tailwind precedence", () => {
    expect(cn("px-2", "px-4", "text-xs", undefined)).toBe("px-4 text-xs");
  });

  it("preserves non-conflicting classes", () => {
    expect(cn("flex", "items-center", "gap-2")).toBe("flex items-center gap-2");
  });
});

describe("getErrorMessage", () => {
  it("returns string rejections directly", () => {
    expect(getErrorMessage("backend failed", "fallback")).toBe(
      "backend failed",
    );
  });

  it("returns Error messages", () => {
    expect(getErrorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("returns object message fields", () => {
    expect(getErrorMessage({ message: "from object" }, "fallback")).toBe(
      "from object",
    );
  });

  it("falls back for unsupported values", () => {
    expect(getErrorMessage(null, "fallback")).toBe("fallback");
  });
});
