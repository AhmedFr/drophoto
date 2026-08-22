import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, vi } from "vitest";
import type { MediaItem } from "@/lib/api/media";
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
  useGalleryStore.setState({ typeFilter: "ALL", sort: "NEWEST", density: "Comfortable" });
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
}

function item(id: number, overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    row: {
      id,
      drive_id: 1,
      rel_path: `photos/${id}.jpg`,
      hash: `hash${id}`,
      size: 1234,
      kind: "photo",
      ext: "jpg",
      width: 100,
      height: 200,
      duration_ms: null,
      taken_at: "2024-06-15T12:00:00Z",
      camera: null,
      lens: null,
      aperture: null,
      shutter: null,
      iso: null,
      focal_mm: null,
      lat: null,
      lon: null,
      missing_at: null,
    },
    thumb_path: `/tmp/thumbs/hash${id}/400.webp`,
    preview_path: `/tmp/thumbs/hash${id}/2000.webp`,
    drive_name: "Kodachrome",
    online: true,
    original_path: null,
    ...overrides,
  };
}

it("renders the Gallery header", async () => {
  mockIPC((cmd) => {
    if (cmd === "query_media") return [];
    if (cmd === "count_media") return 0;
    return undefined;
  });
  renderPage();
  expect(await screen.findByRole("heading")).toHaveTextContent("GALLERY");
  await screen.findByText("0 items");
});

it("shows the item count once media loads", async () => {
  mockIPC((cmd) => {
    if (cmd === "query_media") return [item(1), item(2)];
    if (cmd === "count_media") return 2;
    return undefined;
  });
  renderPage();
  expect(await screen.findByText("2 items")).toBeInTheDocument();
});

it("shows an empty state with a link to /drives when there is no media", async () => {
  mockIPC((cmd) => {
    if (cmd === "query_media") return [];
    if (cmd === "count_media") return 0;
    return undefined;
  });
  renderPage();
  expect(await screen.findByText(/No media yet/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /drive/i })).toHaveAttribute("href", "/drives");
});

it("renders a tile once media loads", async () => {
  mockIPC((cmd) => {
    if (cmd === "query_media") return [item(1), item(2), item(3)];
    if (cmd === "count_media") return 3;
    return undefined;
  });
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
    if (cmd === "count_media") return 0;
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
  mockIPC((cmd) => {
    if (cmd === "query_media") return [item(1), item(2)];
    if (cmd === "count_media") return 2;
    return undefined;
  });
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  await user.click(tiles[0]);

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("01 / 2")).toBeInTheDocument();
});

it("navigates between items with the prev/next buttons, clamped to the loaded range", async () => {
  mockIPC((cmd) => {
    if (cmd === "query_media") return [item(1), item(2)];
    if (cmd === "count_media") return 2;
    return undefined;
  });
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
  mockIPC((cmd) => {
    if (cmd === "query_media") return [item(1), item(2)];
    if (cmd === "count_media") return 2;
    return undefined;
  });
  const user = userEvent.setup();
  renderPage();

  const tiles = await screen.findAllByRole("button", { name: /photos\// });
  await user.click(tiles[0]);
  await screen.findByRole("dialog");

  fireEvent.keyDown(window, { key: "Escape" });

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});
