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
 * Opens the lightbox at `index` from the keyboard.
 *
 * Every test that needs a selection AND an open lightbox at once has to go
 * this way: once anything is selected the gallery is in selection mode, so
 * a plain click on a tile toggles rather than opens (the Google Photos
 * rule). Enter on the roving focus still opens — the mouse path just isn't
 * available while a selection is up.
 */
function openLightboxWithKeyboard(index: number) {
  // The first arrow only establishes focus at 0; each one after advances.
  for (let i = 0; i <= index; i++) fireEvent.keyDown(document.body, { key: "ArrowRight" });
  fireEvent.keyDown(document.body, { key: "Enter" });
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

// Selection mode (Phase 7.5): once anything is selected, a plain click on
// a tile body toggles it instead of opening it. This replaces the old
// contract, where a plain click always opened.
it("toggles instead of opening on a plain click once anything is selected", async () => {
  mockMedia([item(1), item(2)]);
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");

  await user.click(tiles[1]);

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(await screen.findByText("2 SELECTED")).toBeInTheDocument();
});

// ...and the same click on an already-selected tile takes it back out,
// which is the only way to leave selection mode by clicking.
it("deselects the last selected tile on a plain click, leaving selection mode", async () => {
  mockMedia([item(1), item(2)]);
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");

  await user.click(tiles[0]);

  await waitFor(() => expect(screen.queryByText(/SELECTED/)).not.toBeInTheDocument());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

// The mouse path to the lightbox closes in selection mode, so the keyboard
// one has to stay open — otherwise a user with a selection has no way in.
it("still opens the lightbox from the keyboard while a selection is up", async () => {
  mockMedia([item(1), item(2)]);
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");

  openLightboxWithKeyboard(0);

  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("1 SELECTED")).toBeInTheDocument();
});

it("Escape clears a non-empty selection without closing the open lightbox", async () => {
  mockMedia([item(1), item(2)]);
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");

  openLightboxWithKeyboard(1);
  const dialog = await screen.findByRole("dialog");

  fireEvent.keyDown(dialog, { key: "Escape" });

  await waitFor(() => expect(screen.queryByText(/SELECTED/)).not.toBeInTheDocument());
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

// The same contract, but pressed AFTER the lightbox has been stepped. This
// is the case that catches GalleryPage's document-capture Escape listener
// being re-registered while a `Lightbox` is already mounted: the new
// registration lands behind Radix's `DismissableLayer`, Radix wins the
// keystroke, and the lightbox closes while the selection survives — the
// exact inverse of the contract above. The test before this one can't see
// it, because on the opening commit Radix's Portal hasn't mounted yet.
it("still clears the selection instead of closing the lightbox after stepping it", async () => {
  mockMedia([item(1), item(2), item(3)]);
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");

  openLightboxWithKeyboard(1);
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: /next/i }));
  expect(within(screen.getByRole("dialog")).getByText("03 / 3")).toBeInTheDocument();

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

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

  openLightboxWithKeyboard(1);
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

  openLightboxWithKeyboard(1);
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

// ---------------------------------------------------------------------
// Hydration edges (Phase 7.4). The index knows the whole set; rows arrive
// in chunks behind it. A tile the index knows but the chunks haven't
// delivered is a real, reachable state, and none of these paths may strand
// the page. `mockPartiallyHydrated` models it directly: the index reports
// three photos, hydration only ever answers with the first.
// ---------------------------------------------------------------------

function mockPartiallyHydrated() {
  const items = [item(1), item(2), item(3)];
  mockIPC((cmd) => {
    if (cmd === "media_index") return items.map(entryFor);
    if (cmd === "query_media") return [items[0]];
    return undefined;
  });
}

it("lays out every indexed photo, as a placeholder where the row hasn't arrived", async () => {
  mockPartiallyHydrated();
  renderPage();

  expect(await screen.findAllByRole("img")).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "Loading" })).toHaveLength(2);
  expect(await screen.findByText("3 items")).toBeInTheDocument();
});

// Same rule `Tile` applies to a click: opening onto a row that isn't there
// would render an empty dialog and take the keyboard down with it.
it("does not open the lightbox when Enter lands on a row that hasn't arrived", async () => {
  mockPartiallyHydrated();
  renderPage();
  await screen.findAllByRole("img");

  fireEvent.keyDown(document.body, { key: "ArrowRight" }); // focus 0
  fireEvent.keyDown(document.body, { key: "ArrowRight" }); // focus 1 — not hydrated
  expect(useGalleryStore.getState().focusIndex).toBe(1);

  fireEvent.keyDown(document.body, { key: "Enter" });

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  // ...and the grid still answers the keyboard.
  fireEvent.keyDown(document.body, { key: "ArrowLeft" });
  expect(useGalleryStore.getState().focusIndex).toBe(0);
});

it("still opens the lightbox when Enter lands on a row that has arrived", async () => {
  mockPartiallyHydrated();
  renderPage();
  await screen.findAllByRole("img");

  fireEvent.keyDown(document.body, { key: "ArrowRight" }); // focus 0 — hydrated
  fireEvent.keyDown(document.body, { key: "Enter" });

  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});

// THE INVARIANT: the app must never reach a state where the keyboard does
// nothing. Stepping the lightbox past the hydrated rows renders no dialog,
// so there is no Radix layer to take Escape — and the grid's own handler
// yields to the lightbox whenever `openIndex` is set. Without GalleryPage
// answering Escape itself, every key would be dead until a mouse click.
it("recovers from a lightbox stepped onto a row that hasn't arrived", async () => {
  mockPartiallyHydrated();
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  await user.click(tiles[0]);
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("01 / 3")).toBeInTheDocument();

  // Step onto index 1, whose row never arrives: nothing renders.
  await user.click(within(dialog).getByRole("button", { name: /next/i }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  // The keyboard is not dead — Escape gets the page back.
  fireEvent.keyDown(document.body, { key: "Escape" });

  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  expect(useGalleryStore.getState().focusIndex).toBe(0);
  fireEvent.keyDown(document.body, { key: " " });
  expect(useGalleryStore.getState().selectedIds).toEqual([1]);
});

// Escape's existing meaning wins where they compete, exactly as it does
// with a hydrated lightbox (whose Radix layer only sees the keystroke once
// the selection is already clear).
it("clears the selection before closing an unrendered lightbox", async () => {
  mockPartiallyHydrated();
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[0], { metaKey: true });
  await screen.findByText("1 SELECTED");
  openLightboxWithKeyboard(0);
  await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /next/i }));

  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.queryByText(/SELECTED/)).not.toBeInTheDocument();

  fireEvent.keyDown(document.body, { key: "Escape" });
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  // Opening from the keyboard already put focus on index 0, so the arrow
  // advances rather than establishing focus — either way, the grid is
  // answering the keyboard again.
  expect(useGalleryStore.getState().focusIndex).toBe(1);
});

// ---------------------------------------------------------------------
// Generation pairing (Phase 7.4). Geometry and rows are cached separately
// and resolve at different speeds. THE INVARIANT: a tile never displays a
// thumbnail belonging to a different photo than its own id.
// ---------------------------------------------------------------------

/** Answers the first call outright and leaves every later one pending. */
function deferAfterFirst<T>(first: T, later: T) {
  let calls = 0;
  const pending: (() => void)[] = [];
  return {
    handle: () => {
      calls += 1;
      if (calls === 1) return first;
      return new Promise((resolve) => pending.push(() => resolve(later)));
    },
    flush: () => pending.splice(0).forEach((resolve) => resolve()),
  };
}

it("never paints a new generation's thumbnails onto the previous generation's tiles", async () => {
  const index = deferAfterFirst([item(1), item(2)].map(entryFor), [entryFor(item(9))]);
  const rows = deferAfterFirst([item(1), item(2)], [item(9)]);
  mockIPC((cmd) => {
    if (cmd === "media_index") return index.handle();
    if (cmd === "query_media") return rows.handle();
    return undefined;
  });
  const user = userEvent.setup();
  renderPage();
  expect(await screen.findAllByRole("img")).toHaveLength(2);

  // Change the filter, then let ONLY the rows resolve — the index is still
  // describing the old two photos.
  await user.click(screen.getByRole("button", { name: "RAW" }));
  await act(async () => {
    rows.flush();
  });

  // The incoming photo must not be shown against the outgoing geometry.
  expect(screen.queryByAltText("photos/9.jpg")).not.toBeInTheDocument();

  await act(async () => {
    index.flush();
  });
  expect(await screen.findByAltText("photos/9.jpg")).toBeInTheDocument();
});

// The regression this pairing must not cause: `useMediaInfinite` kept
// thumbnails on screen through a settle, and so must this.
it("keeps the current thumbnails on screen while a filter change is in flight", async () => {
  const index = deferAfterFirst([item(1), item(2)].map(entryFor), [entryFor(item(9))]);
  const rows = deferAfterFirst([item(1), item(2)], [item(9)]);
  mockIPC((cmd) => {
    if (cmd === "media_index") return index.handle();
    if (cmd === "query_media") return rows.handle();
    return undefined;
  });
  const user = userEvent.setup();
  renderPage();
  expect(await screen.findAllByRole("img")).toHaveLength(2);

  await user.click(screen.getByRole("button", { name: "RAW" }));

  // Neither side has answered yet: both are still a generation behind
  // together, so the grid keeps painting what it has.
  expect(screen.getByAltText("photos/1.jpg")).toBeInTheDocument();
  expect(screen.getByAltText("photos/2.jpg")).toBeInTheDocument();
});

// The generation stamp is the filter tuple, so it does NOT change when the
// same filters are simply refetched — which is what every
// `invalidateQueries({ queryKey: ["media"] })` in the app does after a
// scan, a tag or place edit, a missing-file reconcile, a date recovery. The
// two sides still land at different times, so position 0 can mean two
// different photos at once. Only the id check at the paint site catches it.
it("shows a placeholder rather than another photo's thumbnail when a refetch lands unevenly", async () => {
  const rows = deferAfterFirst([item(1), item(2)], [item(9), item(1)]);
  mockIPC((cmd) => {
    // The index keeps saying position 0 is photo 1, position 1 is photo 2.
    if (cmd === "media_index") return [item(1), item(2)].map(entryFor);
    if (cmd === "query_media") return rows.handle();
    return undefined;
  });
  const queryClient = renderPage();
  expect(await screen.findAllByRole("img")).toHaveLength(2);

  // A scan prepended a row: the chunks come back with photo 9 at position 0
  // and photo 1 pushed to position 1, while the index still describes the
  // old order. Not awaited — the refetch it starts is the one deliberately
  // left pending until `flush`.
  act(() => {
    void queryClient.invalidateQueries({ queryKey: ["media"] });
  });
  await act(async () => {
    rows.flush();
  });

  // Both tiles now disagree with the rows sitting at their positions, so
  // both fall back to placeholders. Waited for, rather than asserted on the
  // next tick, so this can't pass on a render that simply hasn't happened.
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "Loading" })).toHaveLength(2),
  );

  // The invariant: photo 9's thumbnail never appears on photo 1's tile.
  expect(screen.queryByAltText("photos/9.jpg")).not.toBeInTheDocument();
  expect(screen.queryAllByRole("img")).toHaveLength(0);

  // And the tile still acts as the photo it actually represents — selecting
  // it must target id 1, not the id of the row that briefly sat there.
  fireEvent.click(screen.getAllByRole("button", { name: "Loading" })[0], { metaKey: true });
  expect(useGalleryStore.getState().selectedIds).toEqual([1]);
});

// The same drift as the test above, but reaching the photo through the two
// surfaces that don't draw a tile. These matter more than the grid case:
// the lightbox hosts MetaPanel, whose tag and place actions WRITE against
// `row.id`, and a tag write sets `sidecar_pending` — so a row read from the
// wrong position eventually reaches a real .xmp file on disk.
it("does not open the lightbox on another photo when Enter lands on a drifted row", async () => {
  const rows = deferAfterFirst([item(1), item(2)], [item(9), item(1)]);
  mockIPC((cmd) => {
    if (cmd === "media_index") return [item(1), item(2)].map(entryFor);
    if (cmd === "query_media") return rows.handle();
    if (cmd === "tags_for_media") return [];
    if (cmd === "list_tags") return [];
    return undefined;
  });
  const queryClient = renderPage();
  expect(await screen.findAllByRole("img")).toHaveLength(2);

  fireEvent.keyDown(document.body, { key: "ArrowRight" }); // focus index 0
  expect(useGalleryStore.getState().focusIndex).toBe(0);

  act(() => {
    void queryClient.invalidateQueries({ queryKey: ["media"] });
  });
  await act(async () => {
    rows.flush();
  });
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "Loading" })).toHaveLength(2),
  );

  // Index 0 now holds photo 9's row while the timeline still says photo 1.
  fireEvent.keyDown(document.body, { key: "Enter" });

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  // ...and the grid is still answering the keyboard.
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  expect(useGalleryStore.getState().focusIndex).toBe(1);
});

it("does not swap the displayed photo when a refetch lands under an open lightbox", async () => {
  const rows = deferAfterFirst([item(1), item(2)], [item(9), item(1)]);
  const taggedIds: number[][] = [];
  mockIPC((cmd, args) => {
    if (cmd === "media_index") return [item(1), item(2)].map(entryFor);
    if (cmd === "query_media") return rows.handle();
    if (cmd === "tags_for_media") {
      taggedIds.push((args as { mediaIds: number[] }).mediaIds);
      return [];
    }
    if (cmd === "list_tags") return [];
    return undefined;
  });
  const user = userEvent.setup();
  const queryClient = renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  await user.click(tiles[0]);
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("01 / 2")).toBeInTheDocument();
  await waitFor(() => expect(taggedIds).toContainEqual([1]));

  // A scan prepends a row while the lightbox sits open at index 0. The
  // index doesn't move, so nothing tells the user the photo changed.
  act(() => {
    void queryClient.invalidateQueries({ queryKey: ["media"] });
  });
  await act(async () => {
    rows.flush();
  });
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "Loading" })).toHaveLength(2),
  );

  // Photo 9 must not be displayed, and MetaPanel must not have retargeted
  // onto it — a tag applied there would land on the wrong photo.
  expect(screen.queryByAltText("photos/9.jpg")).not.toBeInTheDocument();
  expect(taggedIds).not.toContainEqual([9]);

  // The page is not stranded: Escape gets the keyboard back.
  fireEvent.keyDown(document.body, { key: "Escape" });
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  expect(useGalleryStore.getState().focusIndex).toBe(0);
});

// ---------------------------------------------------------------------
// Google Photos selection (Phase 7.5): the hover checkmark and the
// drag-select gesture, end to end through the store. The drag is driven
// with raw pointer events — `userEvent` has no sweep-across-elements
// gesture, and what matters here is the sequence, not the pixels.
// ---------------------------------------------------------------------

function checks() {
  return screen.getAllByTestId("tile-check");
}

/** Every tile box, hydrated or not — a drag sweeps across both alike. */
function tileBoxes() {
  return screen.getAllByTestId("tile");
}

/** Press a tile's checkmark, sweep to another tile, release off the grid. */
function dragFrom(fromCheck: number, toTile: number) {
  fireEvent.pointerDown(checks()[fromCheck]);
  fireEvent.pointerEnter(tileBoxes()[toTile]);
  fireEvent.pointerUp(document);
}

/**
 * Click a tile the way a browser does — press, then click. The press
 * matters after a drag: a gesture that ended with no click reaching a tile
 * leaves its claim on the *next* click standing, and it is the next press
 * that drops it.
 */
function clickTile(index: number, init: MouseEventInit = {}) {
  fireEvent.pointerDown(tileBoxes()[index], init);
  // `detail: 1` marks it a pointer click; a keyboard activation is 0, and
  // the two are treated differently by the gesture's click guard.
  fireEvent.click(tileBoxes()[index], { detail: 1, ...init });
}

it("selects a photo from its checkmark without opening the lightbox", async () => {
  mockMedia([item(1), item(2)]);
  const user = userEvent.setup();
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  await user.click(checks()[0]);

  expect(useGalleryStore.getState().selectedIds).toEqual([1]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(await screen.findByText("1 SELECTED")).toBeInTheDocument();
});

it("deselects from the checkmark of an already-selected photo", async () => {
  mockMedia([item(1), item(2)]);
  const user = userEvent.setup();
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  await user.click(checks()[0]);
  expect(useGalleryStore.getState().selectedIds).toEqual([1]);

  await user.click(checks()[0]);
  expect(useGalleryStore.getState().selectedIds).toEqual([]);
});

it("selects the swept range when a drag starts from a checkmark", async () => {
  mockMedia([item(1), item(2), item(3), item(4)]);
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  dragFrom(0, 2);

  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2, 3]);
});

// The reason the gesture emits a whole desired selection rather than ids
// to add: pulling back has to release what the sweep already passed.
it("releases the tiles a drag passed when it reverses back toward the origin", async () => {
  mockMedia([item(1), item(2), item(3), item(4)]);
  renderPage();
  const tiles = await screen.findAllByRole("button", { name: /photos\// });

  fireEvent.pointerDown(checks()[0]);
  fireEvent.pointerEnter(tiles[3]);
  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2, 3, 4]);

  fireEvent.pointerEnter(tiles[1]);
  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2]);

  fireEvent.pointerUp(document);
});

// ...and the other half of the same property: a selection made before the
// drag must survive it.
it("keeps a pre-existing selection while a drag sweeps elsewhere", async () => {
  mockMedia([item(1), item(2), item(3), item(4)]);
  renderPage();
  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  fireEvent.click(tiles[3], { metaKey: true });
  expect(useGalleryStore.getState().selectedIds).toEqual([4]);

  dragFrom(0, 1);

  expect(useGalleryStore.getState().selectedIds).toEqual([4, 1, 2]);
});

it("deselects the swept range when the drag starts on an already-selected photo", async () => {
  mockMedia([item(1), item(2), item(3), item(4)]);
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  fireEvent.keyDown(document.body, { key: "a", metaKey: true });
  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2, 3, 4]);

  dragFrom(0, 2);

  expect(useGalleryStore.getState().selectedIds).toEqual([4]);
});

// The release is listened for on `document`, so letting go anywhere —
// including outside the window — ends the gesture. Nothing may keep
// selecting after that.
it("stops extending the selection once the pointer has been released", async () => {
  mockMedia([item(1), item(2), item(3), item(4)]);
  renderPage();
  const tiles = await screen.findAllByRole("button", { name: /photos\// });

  dragFrom(0, 1);
  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2]);

  fireEvent.pointerEnter(tiles[3]);

  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2]);
});

// A drag leaves a usable anchor behind, so the range can be extended by
// shift-clicking rather than dragged again from the start.
it("anchors a following shift-click at the tile the drag started from", async () => {
  mockMedia([item(1), item(2), item(3), item(4)]);
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  dragFrom(0, 1);
  clickTile(3, { shiftKey: true });

  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2, 3, 4]);
});

it("clears a drag-made selection on Escape", async () => {
  mockMedia([item(1), item(2), item(3)]);
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  dragFrom(0, 2);
  expect(await screen.findByText("3 SELECTED")).toBeInTheDocument();

  fireEvent.keyDown(document.body, { key: "Escape" });

  expect(useGalleryStore.getState().selectedIds).toEqual([]);
});

// Selection is keyed on the timeline index's ids, so it reaches photos the
// grid has not hydrated — the whole point of selecting over the index.
it("drags a selection across photos whose rows have not arrived", async () => {
  mockPartiallyHydrated();
  renderPage();
  await screen.findAllByRole("img");

  dragFrom(0, 2);

  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2, 3]);
});

// THE regression the click guard exists for. The checkmark is a `size-5`
// target, so a few pixels of trackpad drift between press and release is
// routine — and per UI Events the browser then dispatches the click on the
// nearest common ancestor of the two, which is the tile.
it("keeps the selection when a checkmark press releases on the tile body", async () => {
  mockMedia([item(1), item(2)]);
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  fireEvent.pointerDown(checks()[0]);
  expect(useGalleryStore.getState().selectedIds).toEqual([1]);

  // Released a few pixels off the checkmark: the click goes to the tile.
  fireEvent.pointerUp(document);
  fireEvent.click(tileBoxes()[0], { detail: 1 });

  expect(useGalleryStore.getState().selectedIds).toEqual([1]);
});

// The same drift on the LAST selected photo used to be worse than a
// cancelled selection: the stray toggle emptied the selection, which
// dropped the gallery out of selection mode within the same click, and the
// click then fell through to opening the lightbox — from what the user did
// as a checkmark press. "Click the checkmark | Toggles; never opens."
it("never opens the lightbox from a checkmark press that drifts onto the tile", async () => {
  mockMedia([item(1), item(2)]);
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  fireEvent.pointerDown(checks()[0]);
  fireEvent.pointerUp(document);
  fireEvent.click(tileBoxes()[0], { detail: 1 });

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(useGalleryStore.getState().selectedIds).toEqual([1]);
});

// ...and the guard must not outlive its own gesture: the very next click
// on a tile is an ordinary one again.
it("still opens the lightbox on the click after a checkmark gesture", async () => {
  mockMedia([item(1), item(2)]);
  const user = userEvent.setup();
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  fireEvent.pointerDown(checks()[0]);
  fireEvent.pointerUp(document);
  fireEvent.click(tileBoxes()[0], { detail: 1 });
  // Take the selection back off, so the gallery leaves selection mode.
  await user.click(checks()[0]);
  expect(useGalleryStore.getState().selectedIds).toEqual([]);

  await user.click(tileBoxes()[0]);

  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});

it("does not start a sweep from a right-click on the checkmark", async () => {
  mockMedia([item(1), item(2), item(3)]);
  renderPage();
  const tiles = await screen.findAllByRole("button", { name: /photos\// });

  fireEvent.pointerDown(checks()[0], { button: 2 });
  fireEvent.pointerEnter(tiles[2]);

  expect(useGalleryStore.getState().selectedIds).toEqual([]);
});

// The claim on a click has to be dropped by the next press, not linger:
// a drag released off the grid produces no click at all, and the user's
// next click on a tile is an ordinary one.
it("does not swallow an unrelated click made after a drag released off the grid", async () => {
  mockMedia([item(1), item(2), item(3)]);
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  dragFrom(0, 1);
  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2]);

  // Selection mode is on, so this plain click toggles photo 3 in.
  clickTile(2);

  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2, 3]);
});

// A drag released anywhere but its origin tile produces no click at all,
// so its claim on the next click is still standing. A keyboard activation
// has no press in front of it and can never be that click — if it consumed
// the claim, the first Enter after a sweep would silently do nothing.
// Bounded, but still a state where a keystroke is swallowed.
it("still toggles from the keyboard on the first activation after a drag", async () => {
  mockMedia([item(1), item(2), item(3)]);
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  dragFrom(0, 1);
  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2]);

  // Tab to a checkmark and press Enter: a click with no press before it.
  fireEvent.click(checks()[2], { detail: 0 });

  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2, 3]);
});

// ---------------------------------------------------------------------
// Real DOM focus vs. the roving `focusIndex`. GalleryPage handles Enter and
// Space on `document`, against `focusIndex`; a Tab-focused tile handles
// them itself, against its own index. Both used to run on one keystroke,
// and when the two indices differ that acted on two different photos.
// ---------------------------------------------------------------------

it("toggles only the tile that holds focus, not also the roving focusIndex", async () => {
  mockMedia([item(1), item(2), item(3)]);
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  // Roving focus lands on index 0...
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  expect(useGalleryStore.getState().focusIndex).toBe(0);

  // ...while real DOM focus is on a different tile entirely.
  fireEvent.keyDown(tileBoxes()[2], { key: " " });

  // Photo 3 alone. Before the fix this was [3, 1]: the tile's own handler
  // and the document handler both acted, on two different photos.
  expect(useGalleryStore.getState().selectedIds).toEqual([3]);
});

it("opens only the tile that holds focus when Enter is pressed on it", async () => {
  mockMedia([item(1), item(2), item(3)]);
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  fireEvent.keyDown(document.body, { key: "ArrowRight" }); // roving focus at 0
  fireEvent.keyDown(tileBoxes()[2], { key: "Enter" });

  // "03 / 3", not "01 / 3" — the document handler must not have opened the
  // roving index on top of the focused tile's own open.
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("03 / 3")).toBeInTheDocument();
});

// The grid handler still owns these keys when no tile holds focus, which
// is the ordinary case — the roving focus is the only cursor there is.
it("still toggles the roving focus when Space is pressed outside any tile", async () => {
  mockMedia([item(1), item(2), item(3)]);
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  fireEvent.keyDown(document.body, { key: " " });

  expect(useGalleryStore.getState().selectedIds).toEqual([2]);
});

// ---------------------------------------------------------------------
// The month header's select action, which is a checkbox for its section:
// it toggles rather than only adding.
// ---------------------------------------------------------------------

/** The month header's select/deselect action, whichever it currently is. */
function monthAction() {
  return screen.getByRole("button", { name: /^(Select|Deselect) all \d+ in / });
}

it("selects a whole month from its header", async () => {
  mockMedia([item(1), item(2), item(3)]);
  const user = userEvent.setup();
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  await user.click(monthAction());

  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2, 3]);
});

// The spec's requirement: pressing it again lets the section go, rather
// than re-selecting what is already selected — and the label follows.
it("deselects the month when every photo in it is already selected", async () => {
  mockMedia([item(1), item(2), item(3)]);
  const user = userEvent.setup();
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  await user.click(monthAction());
  expect(await screen.findByText("DESELECT ALL")).toBeInTheDocument();

  await user.click(monthAction());

  expect(useGalleryStore.getState().selectedIds).toEqual([]);
  expect(await screen.findByText("SELECT ALL")).toBeInTheDocument();
});

// A half-selected section is not a selected one: the press finishes the
// job. Deselecting here would throw away a selection the user built.
it("selects the rest of a partially selected month rather than deselecting it", async () => {
  mockMedia([item(1), item(2), item(3)]);
  const user = userEvent.setup();
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  await user.click(checks()[1]);
  expect(useGalleryStore.getState().selectedIds).toEqual([2]);

  await user.click(monthAction());

  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2, 3]);
});

// Cmd-click still means "add to what I already have" — and on a section
// that is already wholly in, the only sensible addition is none: it comes
// back out, leaving the rest of the selection alone.
it("adds a month to an existing selection on cmd-click, and takes it back out when it is all in", async () => {
  mockMedia([item(1), item(2), item(3)]);
  const user = userEvent.setup();
  renderPage();
  await screen.findAllByRole("button", { name: /photos\// });

  await user.click(checks()[0]);
  expect(useGalleryStore.getState().selectedIds).toEqual([1]);

  await user.keyboard("{Meta>}");
  await user.click(monthAction());
  await user.keyboard("{/Meta}");
  expect(useGalleryStore.getState().selectedIds).toEqual([1, 2, 3]);

  await user.keyboard("{Meta>}");
  await user.click(monthAction());
  await user.keyboard("{/Meta}");
  expect(useGalleryStore.getState().selectedIds).toEqual([]);
});
