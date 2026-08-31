import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "@/test/renderWithRouter";
import { useGalleryStore } from "../../store/galleryStore";
import { GalleryToolbar } from "./GalleryToolbar";

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

describe("GalleryToolbar", () => {
  it("links the search affordance to /search", async () => {
    renderWithRouter(<GalleryToolbar count={12} />);
    expect(await screen.findByRole("link")).toHaveAttribute("href", "/search");
  });

  it("shows the item count", async () => {
    renderWithRouter(<GalleryToolbar count={12} />);
    expect(await screen.findByText("12 items")).toBeInTheDocument();
  });

  it("gives the count a stable reserved width so filter changes don't shift the toolbar", async () => {
    renderWithRouter(<GalleryToolbar count={12} />);
    const countEl = await screen.findByText("12 items");
    expect(countEl).toHaveClass("tabular-nums", "inline-block", "min-w-[9ch]", "text-right");
  });

  it("renders no count while undefined", async () => {
    renderWithRouter(<GalleryToolbar count={undefined} />);
    await screen.findByRole("link");
    expect(screen.queryByText(/items/)).not.toBeInTheDocument();
  });

  it("renders the type chips, sort menu and density toggle", async () => {
    renderWithRouter(<GalleryToolbar count={0} />);
    expect(await screen.findByRole("button", { name: "ALL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /NEWEST/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Comfortable" })).toBeInTheDocument();
  });
});
