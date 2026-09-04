import type { ReactElement } from "react";
import { screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "@/test/renderWithRouter";
import { useGalleryStore } from "../../store/galleryStore";
import { GalleryToolbar } from "./GalleryToolbar";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// `GalleryToolbar` now renders `MissingChip` (a `count_media` query for the
// "Missing (N)" toggle), so every render needs a `QueryClient` in context —
// wrapping it here keeps every existing call site below unchanged.
function render(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithRouter(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  useGalleryStore.setState({
    typeFilter: "ALL",
    sort: "NEWEST",
    density: "Comfortable",
    query: "",
    tagId: null,
  });
  useGalleryStore.persist.clearStorage();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  // Default: nothing missing, so the pre-existing tests below (none of
  // which care about the "Missing" chip) see a stable, quiet count query
  // instead of a real Tauri IPC call rejecting with no mock configured —
  // same pattern as `DriveCard`'s `count_scan_errors` default.
  mockIPC((cmd) => {
    if (cmd === "count_media") return 0;
    return undefined;
  });
});

describe("GalleryToolbar", () => {
  it("renders a search box with the Search photos placeholder", async () => {
    render(<GalleryToolbar count={12} />);
    expect(await screen.findByPlaceholderText("Search photos")).toBeInTheDocument();
  });

  it("shows the item count", async () => {
    render(<GalleryToolbar count={12} />);
    expect(await screen.findByText("12 items")).toBeInTheDocument();
  });

  it("gives the count a stable reserved width so filter changes don't shift the toolbar", async () => {
    render(<GalleryToolbar count={12} />);
    const countEl = await screen.findByText("12 items");
    expect(countEl).toHaveClass("tabular-nums", "inline-block", "min-w-[12ch]", "text-right");
  });

  it("reserves enough width to fit a five-digit library count (e.g. 16234 items) without shifting", async () => {
    render(<GalleryToolbar count={16234} />);
    const countEl = await screen.findByText("16234 items");
    // "16234 items" is 11 characters; the reserved min-width must be >= that
    // so a real ~16k-photo library doesn't push the toolbar around.
    expect(countEl).toHaveClass("tabular-nums", "inline-block", "min-w-[12ch]", "text-right");
  });

  it("renders no count while undefined", async () => {
    render(<GalleryToolbar count={undefined} />);
    await screen.findByPlaceholderText("Search photos");
    expect(screen.queryByText(/items/)).not.toBeInTheDocument();
  });

  it("renders the type chips, sort menu and density toggle", async () => {
    render(<GalleryToolbar count={0} />);
    expect(await screen.findByRole("button", { name: "ALL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /NEWEST/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Comfortable" })).toBeInTheDocument();
  });

  it("hides the Missing chip when nothing is missing", async () => {
    render(<GalleryToolbar count={0} />);
    await screen.findByPlaceholderText("Search photos");
    expect(screen.queryByRole("button", { name: /Missing/ })).not.toBeInTheDocument();
  });

  it("shows the Missing chip once there's at least one missing row", async () => {
    mockIPC((cmd) => (cmd === "count_media" ? 3 : undefined));
    render(<GalleryToolbar count={0} />);
    expect(await screen.findByRole("button", { name: "Missing (3)" })).toBeInTheDocument();
  });

  it("hides the tag filter chip while no tag filter is active", async () => {
    render(<GalleryToolbar count={0} />);
    await screen.findByPlaceholderText("Search photos");
    expect(screen.queryByText(/^Tag:/)).not.toBeInTheDocument();
  });

  it("shows the tag filter chip once the store's tagId is set", async () => {
    useGalleryStore.setState({ tagId: 2 });
    mockIPC((cmd) => {
      if (cmd === "count_media") return 0;
      if (cmd === "list_tags") return [{ id: 2, name: "Trip" }];
      return undefined;
    });
    render(<GalleryToolbar count={0} />);
    expect(await screen.findByText("Tag: Trip")).toBeInTheDocument();
  });
});
