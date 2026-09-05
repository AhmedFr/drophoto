import { useCallback, useMemo, useState } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { queryMedia, type MediaItem } from "@/lib/api/media";
import { buildQuery, filterKey, useGalleryStore } from "../store/galleryStore";

/**
 * Rows are hydrated in fixed, boundary-aligned chunks so that scrolling
 * reuses cached results instead of refetching a sliding window. Chunk `c`
 * is exactly `query_media` at `offset = c * CHUNK_SIZE`, which lines up
 * with `useMediaIndex` because both compose the same filters and sort.
 */
export const CHUNK_SIZE = 200;

/** The chunk a timeline index falls in. */
export function chunkOf(index: number): number {
  return Math.max(0, Math.floor(index / CHUNK_SIZE));
}

/**
 * Which chunks to hold: every chunk the grid is showing, plus the one the
 * lightbox is in and its two immediate neighbours.
 *
 * With paging gone, next/prev walk the whole set, so hydration has to
 * follow the lightbox and not just the grid — otherwise the first step
 * past the loaded rows opens onto nothing. The neighbours are what make
 * stepping seamless: whichever way the user is going, the chunk they are
 * about to cross into is already in flight.
 *
 * Deliberately a *set* and not the span between the grid and the lightbox.
 * Spanning is unbounded — open the lightbox at index 16000 and hold prev
 * back to 0 and it would subscribe 81 chunks and hold ~16k rows for the
 * whole `staleTime`. This caps the subscription at the visible chunks plus
 * three however far the two drift apart; chunks left behind simply fall
 * out of the active set and are collected normally.
 */
export function hydrationChunks(
  firstVisible: number,
  lastVisible: number,
  openChunk: number | null,
): number[] {
  const chunks = new Set<number>();
  for (let c = firstVisible; c <= lastVisible; c++) chunks.add(c);
  if (openChunk !== null) {
    if (openChunk > 0) chunks.add(openChunk - 1);
    chunks.add(openChunk);
    chunks.add(openChunk + 1);
  }
  return [...chunks].sort((a, b) => a - b);
}

/** What one chunk's query caches: the rows, stamped with what they are. */
type Chunk = { key: string; chunk: number; items: MediaItem[] };

export type MediaChunks = {
  /**
   * The hydrated rows, as a sparse array indexed **parallel to the
   * timeline index** — a tile at index N reads `items[N]` with no offset
   * arithmetic at the call site, and `undefined` simply means "not
   * hydrated yet".
   */
  items: (MediaItem | undefined)[];
  /**
   * The generation (see `filterKey`) every hydrated row here belongs to,
   * or `null` when there is none — or when the loaded chunks disagree,
   * which `GalleryPage` treats as "paint nothing".
   */
  key: string | null;
};

/** Stable identity for the no-data case, so consumers' memos don't churn. */
const EMPTY: MediaChunks = { items: [], key: null };

export function useMediaChunks(
  range: { start: number; end: number },
  /** Where the lightbox is, so hydration follows it. `null` when closed. */
  openIndex: number | null = null,
): MediaChunks {
  const typeFilter = useGalleryStore((s) => s.typeFilter);
  const sort = useGalleryStore((s) => s.sort);
  const missingOnly = useGalleryStore((s) => s.missingOnly);
  const searchQuery = useGalleryStore((s) => s.query);
  const tagId = useGalleryStore((s) => s.tagId);

  // Reduced to chunk numbers before memoizing, so scrolling within a chunk
  // doesn't churn the query set (or `combine`) on every rendered row.
  const first = chunkOf(range.start);
  const last = Math.max(first, chunkOf(range.end));
  const openChunk = openIndex === null ? null : chunkOf(openIndex);
  const chunkIndices = useMemo(
    () => hydrationChunks(first, last, openChunk),
    [first, last, openChunk],
  );

  // `useQueries`' `combine` rather than a `useMemo` over the results array:
  // the results array is a new identity every render, so memoizing on it
  // would rebuild every render, and memoizing on a hand-rolled digest of it
  // would need the dependency list to lie. React Query already recomputes
  // `combine` only when the underlying results (or the set of query keys)
  // actually change, and holds the previous value otherwise — which is
  // exactly the memoization wanted, honestly derived.
  const combine = useCallback(
    (results: UseQueryResult<Chunk, Error>[]): MediaChunks => {
      const items: (MediaItem | undefined)[] = [];
      let key: string | null = null;
      let disagreed = false;

      results.forEach((result, i) => {
        const data = result.data;
        // The `chunk` stamp is checked, not assumed: rows landing at
        // another chunk's offsets is the one way this hook could show a
        // thumbnail under the wrong id, so it is asserted at the point of
        // placement rather than left to the cache's key matching.
        if (!data || data.chunk !== chunkIndices[i]) return;
        if (key === null) key = data.key;
        else if (key !== data.key) disagreed = true;

        const base = data.chunk * CHUNK_SIZE;
        data.items.forEach((item, j) => {
          items[base + j] = item;
        });
      });

      if (key === null) return EMPTY;
      return { items, key: disagreed ? null : key };
    },
    [chunkIndices],
  );

  const combined = useQueries({
    queries: chunkIndices.map((chunk) => ({
      // Nested under "media" for the same reason as `useMediaIndex`'s key:
      // an `invalidateQueries({ queryKey: ["media"] })` anywhere in the app
      // must refetch the hydrated rows too, not just the index.
      queryKey: ["media", "chunk", typeFilter, sort, missingOnly, searchQuery, tagId, chunk],
      queryFn: async (): Promise<Chunk> => {
        const filters = { typeFilter, sort, missingOnly, query: searchQuery, tagId };
        return {
          key: filterKey(filters),
          chunk,
          items: await queryMedia(buildQuery(filters, CHUNK_SIZE, chunk * CHUNK_SIZE)),
        };
      },
      staleTime: 5 * 60 * 1000,
    })),
    combine,
  });

  // Holds the outgoing selection's thumbnails through a settle, so changing
  // a filter or typing in the search box doesn't blank every visible tile
  // to a placeholder for a round trip.
  //
  // This is `keepPreviousData` done by hand, because the option itself is
  // inert here: `QueriesObserver` matches observers to queries by
  // *queryHash* (see `#findMatchingObservers`), so a changed filter builds
  // a brand-new `QueryObserver` with no previous data for
  // `placeholderData` to fall back to. `useMediaIndex`, a plain `useQuery`
  // with one long-lived observer, does not have that problem and uses the
  // option directly.
  //
  // Safe only because of the generation stamp: what is held is a whole
  // coherent snapshot, still labelled with the generation it came from, so
  // `GalleryPage` shows it only while the index is a generation behind
  // too — never painted onto newer geometry.
  // Kept as state adjusted during render (React's documented pattern for a
  // value derived from something that just changed:
  // https://react.dev/learn/you-might-not-need-an-effect) rather than a
  // ref, which cannot be read or written during render. The identity guard
  // holds it to one extra pass per genuine data change, and the return
  // below prefers `combined` outright, so there is never a frame showing
  // the held snapshot when live data exists.
  const [lastLoaded, setLastLoaded] = useState<MediaChunks>(EMPTY);
  if (combined.key !== null && combined !== lastLoaded) setLastLoaded(combined);

  return combined.key !== null ? combined : lastLoaded;
}
