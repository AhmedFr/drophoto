import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach } from "vitest";
import type { MediaQuery } from "@/lib/api/media";
import { mediaItem as item } from "@/test/mediaFactories";
import { filterKey, useGalleryStore } from "../store/galleryStore";
import { CHUNK_SIZE, chunkOf, hydrationChunks, useMediaChunks } from "./useMediaChunks";

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

  await waitFor(() => expect(result.current.items[200]?.row.id).toBe(11));
  expect(result.current.items[201]?.row.id).toBe(12);
  expect(result.current.items[0]).toBeUndefined();
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
  await waitFor(() => expect(result.current.items[0]?.row.id).toBe(1));
  const first = result.current;

  rerender();

  expect(result.current).toBe(first);
});

// ---------------------------------------------------------------------
// Generation pairing. The index and the chunks are cached separately and
// resolve at different speeds, so every result has to say which filter
// selection it actually describes.
// ---------------------------------------------------------------------

it("stamps hydrated rows with the generation they were fetched under", async () => {
  mockIPC((cmd) => (cmd === "query_media" ? [item(1)] : undefined));

  const { result } = renderHook(() => useMediaChunks({ start: 0, end: 1 }), { wrapper });

  await waitFor(() => expect(result.current.key).not.toBeNull());
  expect(result.current.key).toBe(filterKey({ typeFilter: "ALL", sort: "NEWEST" }));
});

it("reports a new generation once the filters change", async () => {
  mockIPC((cmd) => (cmd === "query_media" ? [item(1)] : undefined));

  const { result } = renderHook(() => useMediaChunks({ start: 0, end: 1 }), { wrapper });
  await waitFor(() => expect(result.current.key).not.toBeNull());
  const before = result.current.key;

  act(() => useGalleryStore.setState({ query: "beach" }));

  await waitFor(() => expect(result.current.key).not.toBe(before));
  expect(result.current.key).toBe(
    filterKey({ typeFilter: "ALL", sort: "NEWEST", query: "beach" }),
  );
});

// `keepPreviousData` holds the outgoing thumbnails through a settle rather
// than blanking every visible tile for a round trip. It is only safe
// because the stamp above travels with them.
it("keeps the previous generation's rows while the next fetch is in flight", async () => {
  let resolveSecond: ((value: unknown) => void) | undefined;
  let calls = 0;
  mockIPC((cmd) => {
    if (cmd !== "query_media") return undefined;
    calls += 1;
    if (calls === 1) return [item(1)];
    return new Promise((resolve) => {
      resolveSecond = resolve;
    });
  });

  const { result } = renderHook(() => useMediaChunks({ start: 0, end: 1 }), { wrapper });
  await waitFor(() => expect(result.current.items[0]?.row.id).toBe(1));
  const firstKey = result.current.key;

  act(() => useGalleryStore.setState({ query: "beach" }));

  // Still painting the old set, still honestly labelled as the old set.
  expect(result.current.items[0]?.row.id).toBe(1);
  expect(result.current.key).toBe(firstKey);

  act(() => resolveSecond?.([item(2)]));
  await waitFor(() => expect(result.current.items[0]?.row.id).toBe(2));
  expect(result.current.key).not.toBe(firstKey);
});

// `keepPreviousData` is per observer *position*, so as the range scrolls an
// observer can still be holding the chunk it used to track. Placing that
// data would put rows at another chunk's offsets.
it("never places a chunk's rows at another chunk's offsets", async () => {
  let resolveSecond: ((value: unknown) => void) | undefined;
  let calls = 0;
  mockIPC((cmd) => {
    if (cmd !== "query_media") return undefined;
    calls += 1;
    if (calls === 1) return [item(1), item(2)];
    return new Promise((resolve) => {
      resolveSecond = resolve;
    });
  });

  const { result, rerender } = renderHook(({ range }) => useMediaChunks(range), {
    wrapper,
    initialProps: { range: { start: 0, end: 10 } },
  });
  await waitFor(() => expect(result.current.items[0]?.row.id).toBe(1));

  // Chunk 1's query is in flight; the observer still holds chunk 0's rows.
  rerender({ range: { start: 200, end: 210 } });

  expect(result.current.items[200]).toBeUndefined();
  expect(result.current.items[201]).toBeUndefined();

  act(() => resolveSecond?.([item(9)]));
  await waitFor(() => expect(result.current.items[200]?.row.id).toBe(9));
});

// ---------------------------------------------------------------------
// `hydrationChunks` — which chunks to hold. With paging gone the lightbox
// walks the whole set, so it has to drag hydration along with it; the set
// must stay bounded however far it drifts from the grid.
// ---------------------------------------------------------------------

it("holds just the visible chunks when no lightbox is open", () => {
  expect(hydrationChunks(0, 0, null)).toEqual([0]);
  expect(hydrationChunks(2, 4, null)).toEqual([2, 3, 4]);
});

it("holds the lightbox's chunk and both neighbours, so either direction is ready", () => {
  expect(hydrationChunks(0, 0, 5)).toEqual([0, 4, 5, 6]);
});

it("has no chunk below zero to reach back to", () => {
  expect(hydrationChunks(0, 0, 0)).toEqual([0, 1]);
});

it("does not duplicate a chunk the grid is already showing", () => {
  expect(hydrationChunks(0, 2, 1)).toEqual([0, 1, 2]);
});

// The bound: spanning grid-to-lightbox would subscribe 81 chunks here and
// hold ~16k rows for the whole staleTime.
it("stays bounded when the lightbox has walked far away from the grid", () => {
  expect(hydrationChunks(0, 1, chunkOf(16_000))).toEqual([0, 1, 79, 80, 81]);
  expect(hydrationChunks(0, 1, chunkOf(16_000))).toHaveLength(5);
});

it("maps an index to its chunk", () => {
  expect(chunkOf(0)).toBe(0);
  expect(chunkOf(199)).toBe(0);
  expect(chunkOf(200)).toBe(1);
  expect(chunkOf(-5)).toBe(0);
});

// The reviewer's repro: hold the next key and the lightbox must not run off
// the end of the hydrated rows.
it("requests the chunk the lightbox is about to step into", async () => {
  const offsets: number[] = [];
  collectOffsets(offsets);

  const { rerender } = renderHook(({ openIndex }) => useMediaChunks({ start: 0, end: 10 }, openIndex), {
    wrapper,
    initialProps: { openIndex: null as number | null },
  });
  await waitFor(() => expect(offsets).toEqual([0]));

  // Still inside chunk 0, but chunk 1 is now the neighbour — fetched before
  // next/prev ever arrives there.
  rerender({ openIndex: 190 });

  await waitFor(() => expect(offsets.sort((a, b) => a - b)).toEqual([0, 200]));
});

it("subscribes a bounded number of chunks however far the lightbox travels", async () => {
  const offsets: number[] = [];
  collectOffsets(offsets);

  const { rerender } = renderHook(({ openIndex }) => useMediaChunks({ start: 0, end: 10 }, openIndex), {
    wrapper,
    initialProps: { openIndex: 16_000 as number | null },
  });
  await waitFor(() => expect(offsets.length).toBeGreaterThan(0));
  offsets.length = 0;

  // Walk back toward the start a chunk at a time.
  for (let index = 15_800; index >= 0; index -= 200) rerender({ openIndex: index });

  // Each step adds at most its own chunk and the next neighbour — never the
  // whole span back to the grid.
  await waitFor(() => expect(offsets.length).toBeLessThanOrEqual(82));
  expect(new Set(offsets).size).toBeLessThanOrEqual(82);
});
