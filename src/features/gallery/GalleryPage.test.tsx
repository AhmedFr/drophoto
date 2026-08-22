import { fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import type { MediaItem } from "@/lib/api/media";
import { renderWithRouter } from "@/test/renderWithRouter";
import { useGalleryStore } from "./store/galleryStore";
import { GalleryPage } from "./GalleryPage";

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return { ...actual, convertFileSrc: (path: string) => `asset://mock/${path}` };
});

beforeEach(() => {
  useGalleryStore.setState({ typeFilter: "ALL", sort: "NEWEST", density: "Comfortable" });
  useGalleryStore.persist.clearStorage();
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

it("renders the grid when items exist", async () => {
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

it("loads the next page when Load more is clicked", async () => {
  const firstPage = Array.from({ length: 500 }, (_, i) => item(i));
  const secondPage = [item(500), item(501)];
  const calls: unknown[] = [];
  mockIPC((cmd, args) => {
    if (cmd === "query_media") {
      calls.push(args);
      return calls.length === 1 ? firstPage : secondPage;
    }
    if (cmd === "count_media") return 502;
    return undefined;
  });
  renderPage();

  const loadMore = await screen.findByRole("button", { name: /load more/i });
  fireEvent.click(loadMore);

  await screen.findByText("502 items");
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({ query: { offset: 500 } });
});
