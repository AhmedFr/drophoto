import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach } from "vitest";
import type { MediaQuery } from "@/lib/api/media";
import { mediaItem as item } from "@/test/mediaFactories";
import { useGalleryStore } from "../store/galleryStore";
import { CHUNK_SIZE, useMediaChunks } from "./useMediaChunks";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  useGalleryStore.setState({
    typeFilter: "ALL",
    sort: "NEWEST",
    density: "Comfortable",
    missingOnly: false,
    query: "",
    tagId: null,
  });
  useGalleryStore.persist.clearStorage();
});

function collectOffsets(offsets: number[]) {
  mockIPC((cmd, a) => {
    if (cmd === "query_media") {
      offsets.push((a as { query: { offset: number } }).query.offset);
      return [];
    }
    return undefined;
  });
}

it("fetches only the chunks covering the visible range", async () => {
  const offsets: number[] = [];
  collectOffsets(offsets);

  renderHook(() => useMediaChunks({ start: 250, end: 260 }), { wrapper });

  // 250-260 sits entirely inside chunk 1 (200-399).
  await waitFor(() => expect(offsets).toEqual([200]));
});

it("fetches both chunks when the range straddles a boundary", async () => {
  const offsets: number[] = [];
  collectOffsets(offsets);

  renderHook(() => useMediaChunks({ start: 190, end: 210 }), { wrapper });

  await waitFor(() => expect(offsets.sort((a, b) => a - b)).toEqual([0, 200]));
});

it("places hydrated items at their absolute index", async () => {
  mockIPC((cmd) => (cmd === "query_media" ? [item(11), item(12)] : undefined));

  const { result } = renderHook(() => useMediaChunks({ start: 200, end: 201 }), { wrapper });

  await waitFor(() => expect(result.current[200]?.row.id).toBe(11));
  expect(result.current[201]?.row.id).toBe(12);
  expect(result.current[0]).toBeUndefined();
});

it("asks for exactly one chunk's worth of rows per chunk", async () => {
  let args: unknown;
  mockIPC((cmd, a) => {
    if (cmd === "query_media") {
      args = a;
      return [];
    }
    return undefined;
  });

  renderHook(() => useMediaChunks({ start: 0, end: 10 }), { wrapper });

  await waitFor(() => expect(args).toBeDefined());
  expect((args as { query: MediaQuery }).query.limit).toBe(CHUNK_SIZE);
});

it("composes the same filters as the index, so offsets line up", async () => {
  useGalleryStore.setState({ query: "beach", tagId: 7, missingOnly: true });
  let args: unknown;
  mockIPC((cmd, a) => {
    if (cmd === "query_media") {
      args = a;
      return [];
    }
    return undefined;
  });

  renderHook(() => useMediaChunks({ start: 0, end: 10 }), { wrapper });

  await waitFor(() => expect(args).toBeDefined());
  expect(args).toMatchObject({ query: { query: "beach", tag_ids: [7], missing: true } });
});

// The whole reason chunks are boundary-aligned rather than a sliding
// window: scrolling within an already-fetched chunk must be a cache hit.
it("does not refetch a chunk the range moves around within", async () => {
  const offsets: number[] = [];
  collectOffsets(offsets);

  const { rerender } = renderHook(({ range }) => useMediaChunks(range), {
    wrapper,
    initialProps: { range: { start: 10, end: 20 } },
  });
  await waitFor(() => expect(offsets).toEqual([0]));

  rerender({ range: { start: 30, end: 40 } });

  await waitFor(() => expect(offsets).toEqual([0]));
});

// A stable identity keeps consumers that memoize on the items array from
// recomputing on every render of the gallery.
it("keeps a referentially stable array across renders when nothing has changed", async () => {
  mockIPC((cmd) => (cmd === "query_media" ? [item(1), item(2)] : undefined));

  const { result, rerender } = renderHook(() => useMediaChunks({ start: 0, end: 1 }), { wrapper });
  await waitFor(() => expect(result.current[0]?.row.id).toBe(1));
  const first = result.current;

  rerender();

  expect(result.current).toBe(first);
});
