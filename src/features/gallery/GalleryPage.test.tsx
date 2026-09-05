import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, vi } from "vitest";
import type { MediaItem } from "@/lib/api/media";
import { entryFor, mediaItem } from "@/test/mediaFactories";
import { virtualizerMockFactory } from "@/test/mockVirtualizer";
import { renderWithRouter } from "@/test/renderWithRouter";
import { useGalleryStore } from "./store/galleryStore";
import { GalleryPage } from "./GalleryPage";

vi.mock("@tanstack/react-virtual", () => virtualizerMockFactory());

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return { ...actual, convertFileSrc: (path: string) => `asset://mock/${path}` };
});

vi.mock("@tauri-apps/plugin-opener");

class ResizeObserverStub {
  #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }

  observe() {
    this.#callback(
      [{ contentRect: { width: 1000 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }

  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  useGalleryStore.setState({
    typeFilter: "ALL",
    sort: "NEWEST",
    density: "Comfortable",
    selectedIds: [],
    anchorIndex: null,
    query: "",
  });
  useGalleryStore.persist.clearStorage();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithRouter(
    <QueryClientProvider client={queryClient}>
      <GalleryPage />
    </QueryClientProvider>,
  );
  return queryClient;
}

function item(id: number, overrides: Partial<MediaItem> = {}): MediaItem {
  return mediaItem(id, overrides);
}

/**
 * The gallery reads a set through two commands that must agree: the
 * timeline index (`media_index`, the whole filtered set as geometry) and
 * chunked hydration (`query_media` at chunk-aligned offsets). Mocking both
 * from one list keeps them in the offset parity the real backend
 * guarantees. `extra` answers any other command the test needs.
 */
function mockMedia(items: MediaItem[], extra?: (cmd: string, args: unknown) => unknown) {
  mockIPC((cmd, args) => {
    if (cmd === "media_index") return items.map(entryFor);
    if (cmd === "query_media") return items;
    return extra?.(cmd, args);
  });
}

it("renders the Gallery header", async () => {
  mockMedia([]);
  renderPage();
  expect(await screen.findByRole("heading")).toHaveTextContent("GALLERY");
  await screen.findByText("0 items");
});

it("shows the item count once media loads", async () => {
  mockMedia([item(1), item(2)]);
  renderPage();
  expect(await screen.findByText("2 items")).toBeInTheDocument();
});

it("shows an empty state with a link to /drives when there is no media", async () => {
  mockMedia([]);
  renderPage();
  expect(await screen.findByText(/No media yet/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /drive/i })).toHaveAttribute("href", "/drives");
});

// A query that matches nothing must say so, rather than showing the
// "No media yet — register and scan a drive" onboarding copy, which
// would read as though the whole library had vanished.
it("shows a query-specific empty state when a search matches nothing", async () => {
  mockMedia([]);
  useGalleryStore.setState({ query: "nonexistent" });
  renderPage();

  expect(await screen.findByText('No photos match "nonexistent"')).toBeInTheDocument();
  expect(screen.queryByText(/No media yet/i)).not.toBeInTheDocument();
});

it("renders a tile once media loads", async () => {
  mockMedia([item(1), item(2), item(3)]);
  renderPage();
  expect(await screen.findAllByRole("img")).toHaveLength(3);
  expect(screen.queryByText(/No media yet/i)).not.toBeInTheDocument();
});

it("shows an error message when the media query fails", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  renderPage();
  expect(await screen.findByText("boom")).toBeInTheDocument();
});

it("changing a type chip re-queries media with the new filter", async () => {
  const calls: { exts: string[] }[] = [];
  mockIPC((cmd, args) => {
    if (cmd === "query_media") {
      const { query } = args as { query: { exts: string[] } };
      calls.push(query);
      return [];
    }
    if (cmd === "media_index") return [];
    return undefined;
  });
  const user = userEvent.setup();
  renderPage();

  await screen.findByText("0 items");
  await user.click(await screen.findByRole("button", { name: "RAW" }));

  await waitFor(() => {
    const last = calls[calls.length - 1];
    expect(last?.exts).toEqual(["raf", "cr2", "cr3", "arw", "nef", "dng", "orf", "rw2"]);
  });
});

it("opens the lightbox when a tile is clicked", async () => {
  mockMedia([item(1), item(2)]);
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  await user.click(tiles[0]);

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("01 / 2")).toBeInTheDocument();
});

it("navigates between items with the prev/next buttons, clamped to the loaded range", async () => {
  mockMedia([item(1), item(2)]);
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  await user.click(tiles[0]);

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("01 / 2")).toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: /next/i }));
  expect(within(dialog).getByText("02 / 2")).toBeInTheDocument();

  // Already at the last loaded item — clicking Next again stays put.
  await user.click(within(dialog).getByRole("button", { name: /next/i }));
  expect(within(dialog).getByText("02 / 2")).toBeInTheDocument();

  await user.click(within(dialog).getByRole("button", { name: /previous/i }));
  expect(within(dialog).getByText("01 / 2")).toBeInTheDocument();

  // Already at the first item — clicking Previous again stays put.
  await user.click(within(dialog).getByRole("button", { name: /previous/i }));
  expect(within(dialog).getByText("01 / 2")).toBeInTheDocument();
});

it("closes the lightbox on Escape", async () => {
  mockMedia([item(1), item(2)]);
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  await user.click(tiles[0]);
  const dialog = await screen.findByRole("dialog");

  // Dispatched on the dialog (not `window`) so it bubbles to `document`,
  // exercising Radix's own `Dialog.Content` Escape handling — the Lightbox
  // no longer double-handles Escape itself (see useKeyboardNav usage).
  fireEvent.keyDown(dialog, { key: "Escape" });

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("clamps the open lightbox index when a refetch shrinks the item list", async () => {
  let indexCalls = 0;
  mockIPC((cmd) => {
    if (cmd === "media_index") {
      indexCalls += 1;
      return (indexCalls === 1 ? [item(1), item(2)] : [item(1)]).map(entryFor);
    }
    if (cmd === "query_media") return [item(1), item(2)];
    return undefined;
  });
  const user = userEvent.setup();
  const queryClient = renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  await user.click(tiles[1]);

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("02 / 2")).toBeInTheDocument();

  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ["media"] });
  });

  await waitFor(() => {
    expect(within(screen.getByRole("dialog")).getByText("01 / 1")).toBeInTheDocument();
  });
});

it("shows the selection bar with a count after a cmd-click", async () => {
  mockMedia([item(1), item(2), item(3)]);
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });

  expect(await screen.findByText("1 SELECTED")).toBeInTheDocument();
});

it("does not show the selection bar when nothing is selected", async () => {
  mockMedia([item(1), item(2)]);
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });
  expect(screen.queryByText(/SELECTED/)).not.toBeInTheDocument();
});

it("clears the selection when CLEAR is clicked", async () => {
  mockMedia([item(1), item(2)]);
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");

  await user.click(screen.getByRole("button", { name: "CLEAR" }));
  expect(screen.queryByText(/SELECTED/)).not.toBeInTheDocument();
});

it("a shift-click with no prior anchor behaves like a plain toggle", async () => {
  mockMedia([item(1), item(2), item(3)]);
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[1], { shiftKey: true });

  expect(await screen.findByText("1 SELECTED")).toBeInTheDocument();
});

it("a shift-click after a cmd-click selects the range between them", async () => {
  mockMedia([item(1), item(2), item(3), item(4)]);
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  fireEvent.click(tiles[2], { shiftKey: true });

  expect(await screen.findByText("3 SELECTED")).toBeInTheDocument();
});

it("still opens the lightbox on a plain click of a selected tile", async () => {
  mockMedia([item(1), item(2)]);
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");

  await user.click(tiles[0]);
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("1 SELECTED")).toBeInTheDocument();
});

it("Escape clears a non-empty selection without closing the open lightbox", async () => {
  mockMedia([item(1), item(2)]);
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");

  await user.click(tiles[1]);
  const dialog = await screen.findByRole("dialog");

  fireEvent.keyDown(dialog, { key: "Escape" });

  await waitFor(() => expect(screen.queryByText(/SELECTED/)).not.toBeInTheDocument());
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("TAG opens the TagPanel for the current selection", async () => {
  mockMedia([item(1), item(2)], (cmd) => (cmd === "list_tags" || cmd === "tags_for_media" ? [] : undefined));
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");

  await user.click(screen.getByRole("button", { name: "TAG" }));

  expect(await screen.findByRole("dialog", { name: /tags/i })).toBeInTheDocument();
});

it("Escape while the selection TagPanel is open closes only the panel and keeps the selection", async () => {
  mockMedia([item(1), item(2)], (cmd) => (cmd === "list_tags" || cmd === "tags_for_media" ? [] : undefined));
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");

  await user.click(screen.getByRole("button", { name: "TAG" }));
  const tagDialog = await screen.findByRole("dialog", { name: /tags/i });

  fireEvent.keyDown(tagDialog, { key: "Escape" });

  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: /tags/i })).not.toBeInTheDocument(),
  );
  expect(screen.getByText("1 SELECTED")).toBeInTheDocument();
});

it("Escape while MetaPanel's +-opened TagPanel is open keeps the background selection and the lightbox", async () => {
  mockMedia([item(1), item(2)], (cmd) => (cmd === "list_tags" || cmd === "tags_for_media" ? [] : undefined));
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");

  await user.click(tiles[1]);
  const lightboxDialog = await screen.findByRole("dialog");

  await user.click(within(lightboxDialog).getByRole("button", { name: /add tag/i }));
  const tagDialog = await screen.findByRole("dialog", { name: /tags/i });

  fireEvent.keyDown(tagDialog, { key: "Escape" });

  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: /tags/i })).not.toBeInTheDocument(),
  );
  expect(screen.getByText("1 SELECTED")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("PLACE opens the PlacePanel for the current selection", async () => {
  mockMedia([item(1), item(2)]);
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");

  await user.click(screen.getByRole("button", { name: "PLACE" }));

  expect(await screen.findByRole("dialog", { name: /place/i })).toBeInTheDocument();
});

it("Escape while the selection PlacePanel is open closes only the panel and keeps the selection", async () => {
  mockMedia([item(1), item(2)]);
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");

  await user.click(screen.getByRole("button", { name: "PLACE" }));
  const placeDialog = await screen.findByRole("dialog", { name: /place/i });

  fireEvent.keyDown(placeDialog, { key: "Escape" });

  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: /place/i })).not.toBeInTheDocument(),
  );
  expect(screen.getByText("1 SELECTED")).toBeInTheDocument();
});

it("Escape while MetaPanel's Change-opened PlacePanel is open keeps the background selection and the lightbox", async () => {
  mockMedia([item(1), item(2)]);
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");

  await user.click(tiles[1]);
  const lightboxDialog = await screen.findByRole("dialog");

  await user.click(within(lightboxDialog).getByRole("button", { name: /change/i }));
  const placeDialog = await screen.findByRole("dialog", { name: /place/i });

  fireEvent.keyDown(placeDialog, { key: "Escape" });

  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: /place/i })).not.toBeInTheDocument(),
  );
  expect(screen.getByText("1 SELECTED")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("Escape still clears the selection when no panel is open", async () => {
  mockMedia([item(1), item(2)]);
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");

  fireEvent.keyDown(document.body, { key: "Escape" });

  await waitFor(() => expect(screen.queryByText(/SELECTED/)).not.toBeInTheDocument());
});

it("clears the selection on unmount", async () => {
  mockMedia([item(1), item(2)]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = renderWithRouter(
    <QueryClientProvider client={queryClient}>
      <GalleryPage />
    </QueryClientProvider>,
  );

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");

  unmount();

  expect(useGalleryStore.getState().selectedIds).toEqual([]);
});

// ---------------------------------------------------------------------
// Grid keyboard handling (Phase 6.3). The handler lives on `document`, so
// these dispatch to `document.body` unless a specific target matters.
// ---------------------------------------------------------------------

function mockThreeItems() {
  mockMedia([item(1), item(2), item(3)]);
}

it("selects every loaded item on ⌘A", async () => {
  mockThreeItems();
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  fireEvent.keyDown(document.body, { key: "a", metaKey: true });

  expect(useGalleryStore.getState().selectedIds).toHaveLength(3);
  expect(await screen.findByText("3 SELECTED")).toBeInTheDocument();
});

// The whole point of the guard: the toolbar's search box is a real input,
// and typing "a" in it must never select the entire library.
it("does not select all when ⌘A is pressed inside the search box", async () => {
  mockThreeItems();
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });
  const search = screen.getByPlaceholderText("Search photos");

  fireEvent.keyDown(search, { key: "a", metaKey: true });

  expect(useGalleryStore.getState().selectedIds).toEqual([]);
});

it("does not toggle selection when Space is pressed inside the search box", async () => {
  mockThreeItems();
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });
  const search = screen.getByPlaceholderText("Search photos");

  fireEvent.keyDown(search, { key: " " });

  expect(useGalleryStore.getState().selectedIds).toEqual([]);
});

it("does not move grid focus when an arrow key is pressed inside the search box", async () => {
  mockThreeItems();
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });
  const search = screen.getByPlaceholderText("Search photos");

  fireEvent.keyDown(search, { key: "ArrowRight" });

  expect(useGalleryStore.getState().focusIndex).toBeNull();
});

it("moves focus with ArrowRight and toggles the focused tile with Space", async () => {
  mockThreeItems();
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  // The first arrow just establishes focus at item 0, the second advances.
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  expect(useGalleryStore.getState().focusIndex).toBe(0);
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  expect(useGalleryStore.getState().focusIndex).toBe(1);

  fireEvent.keyDown(document.body, { key: " " });

  expect(useGalleryStore.getState().selectedIds).toEqual([2]);
});

it("grows and then shrinks the selection as Shift+Arrow reverses direction", async () => {
  mockThreeItems();
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  fireEvent.keyDown(document.body, { key: "ArrowRight" }); // focus 0, anchor 0
  fireEvent.keyDown(document.body, { key: "ArrowRight", shiftKey: true }); // 0..1
  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2]);

  fireEvent.keyDown(document.body, { key: "ArrowRight", shiftKey: true }); // 0..2
  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2, 3]);

  // Retreating toward the anchor must SHRINK the range, not keep growing.
  fireEvent.keyDown(document.body, { key: "ArrowLeft", shiftKey: true }); // back to 0..1
  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2]);
});

// Escape's existing contract (clear the selection) must survive the new
// keyboard handler being registered alongside it.
it("still clears the selection on Escape after keyboard selection", async () => {
  mockThreeItems();
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  fireEvent.keyDown(document.body, { key: "a", metaKey: true });
  expect(useGalleryStore.getState().selectedIds).toHaveLength(3);

  fireEvent.keyDown(document.body, { key: "Escape" });

  expect(useGalleryStore.getState().selectedIds).toEqual([]);
});
