import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import type { MediaItem } from "@/lib/api/media";
import { GalleryPage } from "./GalleryPage";

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return { ...actual, convertFileSrc: (path: string) => `asset://mock/${path}` };
});

function renderPage() {
  const queryClient = new QueryClient();
  render(
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
    drive_name: "Kodachrome",
    online: true,
    ...overrides,
  };
}

it("renders the Gallery header", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_media") return [];
    return undefined;
  });
  renderPage();
  expect(screen.getByRole("heading")).toHaveTextContent("GALLERY");
  await screen.findByText("0 items");
});

it("shows the item count once media loads", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_media") return [item(1), item(2)];
    return undefined;
  });
  renderPage();
  expect(await screen.findByText("2 items")).toBeInTheDocument();
});

it("shows an empty state with a link to /drives when there is no media", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_media") return [];
    return undefined;
  });
  renderPage();
  expect(await screen.findByText(/No media yet/i)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /drive/i })).toHaveAttribute("href", "/drives");
});

it("renders the grid when items exist", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_media") return [item(1), item(2), item(3)];
    return undefined;
  });
  renderPage();
  expect(await screen.findAllByRole("img")).toHaveLength(3);
  expect(screen.queryByText(/No media yet/i)).not.toBeInTheDocument();
});
