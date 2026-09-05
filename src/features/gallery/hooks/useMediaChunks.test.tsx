import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach } from "vitest";
import type { MediaQuery } from "@/lib/api/media";
import { mediaItem as item } from "@/test/mediaFactories";
import { filterKey, useGalleryStore } from "../store/galleryStore";
import { CHUNK_SIZE, coveringRange, useMediaChunks } from "./useMediaChunks";

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
// `coveringRange` — which rows must be hydrated. With paging gone, the
// lightbox walks the whole set, so it has to drag the fetched chunks along
// with it or it opens onto nothing one step past the loaded rows.
// ---------------------------------------------------------------------

it("hydrates just the visible span when no lightbox is open", () => {
  expect(coveringRange({ start: 10, end: 40 }, null)).toEqual({ start: 10, end: 40 });
});

it("reaches ahead of the lightbox so the next step is already requested", () => {
  // 199 is the last index of chunk 0; the range must already name 200 so
  // chunk 1 is in flight before next/prev arrives there.
  expect(coveringRange({ start: 0, end: 199 }, 199)).toEqual({ start: 0, end: 200 });
});

it("widens to cover a lightbox that has walked past the visible span", () => {
  expect(coveringRange({ start: 0, end: 40 }, 420)).toEqual({ start: 0, end: 421 });
});

it("widens backwards for a lightbox behind the visible span", () => {
  expect(coveringRange({ start: 400, end: 440 }, 12)).toEqual({ start: 12, end: 440 });
});

// The reviewer's repro: hold the next key and the lightbox must not run off
// the end of the hydrated rows.
it("keeps requesting the chunk the lightbox has moved into", async () => {
  const offsets: number[] = [];
  collectOffsets(offsets);

  const { rerender } = renderHook(({ openIndex }) => useMediaChunks(coveringRange({ start: 0, end: 10 }, openIndex)), {
    wrapper,
    initialProps: { openIndex: 5 as number | null },
  });
  await waitFor(() => expect(offsets).toEqual([0]));

  rerender({ openIndex: 205 });

  await waitFor(() => expect(offsets.sort((a, b) => a - b)).toEqual([0, 200]));
});
