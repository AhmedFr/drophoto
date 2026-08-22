import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGalleryStore } from "../../store/galleryStore";
import { DensityToggle } from "./DensityToggle";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  useGalleryStore.setState({ typeFilter: "ALL", sort: "NEWEST", density: "Comfortable" });
  useGalleryStore.persist.clearStorage();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

describe("DensityToggle", () => {
  it("renders a pressed toggle for the active density", () => {
    render(<DensityToggle />);
    expect(screen.getByRole("radio", { name: "Comfortable" })).toHaveAttribute("aria-checked", "true");
  });

  it("selecting Dense updates the store", async () => {
    const user = userEvent.setup();
    render(<DensityToggle />);

    await user.click(screen.getByRole("radio", { name: "Dense" }));

    expect(useGalleryStore.getState().density).toBe("Dense");
  });

  it("re-clicking the active option keeps density set (ignores empty deselect)", async () => {
    const user = userEvent.setup();
    render(<DensityToggle />);

    await user.click(screen.getByRole("radio", { name: "Comfortable" }));

    expect(useGalleryStore.getState().density).toBe("Comfortable");
  });
});
