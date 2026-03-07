import { cn } from "@/lib/utils";
import { describe, expect, it } from "vitest";

describe("cn", () => {
  it("merges utility classes with tailwind precedence", () => {
    expect(cn("px-2", "px-4", "text-xs", undefined)).toBe("px-4 text-xs");
  });

  it("preserves non-conflicting classes", () => {
    expect(cn("flex", "items-center", "gap-2")).toBe("flex items-center gap-2");
  });
});
