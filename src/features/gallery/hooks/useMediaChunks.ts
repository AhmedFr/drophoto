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

/**
 * What to hydrate: the span the grid is showing, widened to reach an open
 * lightbox.
 *
 * With paging gone, next/prev walk the whole set, so the fetched chunks
 * have to follow the lightbox and not just the grid — otherwise the first
 * step past the loaded rows opens onto nothing. The `+ 1` requests the
 * next chunk one step before next/prev actually crosses into it.
 *
 * The span between the two ends is fetched as well, but that is exactly
 * the run the lightbox is walking through, and the grid does not scroll
 * while it is up — so this stays bounded by how far the user has actually
 * navigated.
 */
export function coveringRange(
  visible: { start: number; end: number },
  openIndex: number | null,
): { start: number; end: number } {
  if (openIndex === null) return visible;
  return {
    start: Math.min(visible.start, openIndex),
    end: Math.max(visible.end, openIndex + 1),
  };
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

export function useMediaChunks(range: { start: number; end: number }): MediaChunks {
  const typeFilter = useGalleryStore((s) => s.typeFilter);
  const sort = useGalleryStore((s) => s.sort);
  const missingOnly = useGalleryStore((s) => s.missingOnly);
  const searchQuery = useGalleryStore((s) => s.query);
  const tagId = useGalleryStore((s) => s.tagId);

  const first = Math.max(0, Math.floor(range.start / CHUNK_SIZE));
  const last = Math.max(first, Math.floor(range.end / CHUNK_SIZE));
  const chunkIndices = useMemo(
    () => Array.from({ length: last - first + 1 }, (_, i) => first + i),
    [first, last],
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
