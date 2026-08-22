import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { MediaItem } from "@/lib/api/media";
import { useGalleryStore } from "../store/galleryStore";
import { PAGE_SIZE, useMediaInfinite } from "./useMediaInfinite";

function item(id: number): MediaItem {
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
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  useGalleryStore.setState({ typeFilter: "ALL", sort: "NEWEST", density: "Comfortable" });
  useGalleryStore.persist.clearStorage();
});

it("paginates through query_media results", async () => {
  const firstPage = Array.from({ length: PAGE_SIZE }, (_, i) => item(i));
  const secondPage = [item(500), item(501), item(502)];
  let calls = 0;
  mockIPC((cmd) => {
    if (cmd === "query_media") {
      calls += 1;
      return calls === 1 ? firstPage : secondPage;
    }
    return undefined;
  });

  const { result } = renderHook(() => useMediaInfinite(), { wrapper });

  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.items).toHaveLength(PAGE_SIZE);
  expect(result.current.hasNextPage).toBe(true);

  await result.current.fetchNextPage();

  await waitFor(() => expect(result.current.items).toHaveLength(503));
  expect(result.current.hasNextPage).toBe(false);
});

it("surfaces query errors", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });

  const { result } = renderHook(() => useMediaInfinite(), { wrapper });

  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error).toBeInstanceOf(Error);
});
