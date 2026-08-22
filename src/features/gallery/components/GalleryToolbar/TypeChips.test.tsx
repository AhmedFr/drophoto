import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useGalleryStore } from "../../store/galleryStore";
import { TypeChips } from "./TypeChips";

beforeEach(() => {
  useGalleryStore.setState({ typeFilter: "ALL", sort: "NEWEST", density: "Comfortable" });
  useGalleryStore.persist.clearStorage();
});

describe("TypeChips", () => {
  it("renders a chip for every TYPE_FILTERS entry with ALL active by default", () => {
    render(<TypeChips />);
    const all = screen.getByRole("button", { name: "ALL" });
    const raw = screen.getByRole("button", { name: "RAW" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(raw).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking RAW sets the store's typeFilter and updates aria-pressed", async () => {
    const user = userEvent.setup();
    render(<TypeChips />);
    await user.click(screen.getByRole("button", { name: "RAW" }));

    expect(useGalleryStore.getState().typeFilter).toBe("RAW");
    expect(screen.getByRole("button", { name: "RAW" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "ALL" })).toHaveAttribute("aria-pressed", "false");
  });
});
