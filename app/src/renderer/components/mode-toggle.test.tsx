import { ModeToggle } from "@/components/mode-toggle";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setThemeMock = vi.fn();

vi.mock("next-themes", () => ({
  useTheme: () => ({
    setTheme: setThemeMock,
  }),
}));

describe("ModeToggle", () => {
  beforeEach(() => {
    setThemeMock.mockReset();
  });

  it("sets dark mode from dropdown action", async () => {
    render(<ModeToggle />);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: /toggle theme/i }),
    );
    fireEvent.click(await screen.findByText("Dark"));

    expect(setThemeMock).toHaveBeenCalledWith("dark");
  });
});
