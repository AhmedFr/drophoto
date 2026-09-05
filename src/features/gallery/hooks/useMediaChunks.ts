import { useCallback, useMemo } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { queryMedia, type MediaItem } from "@/lib/api/media";
import { buildQuery, useGalleryStore } from "../store/galleryStore";

/**
 * Rows are hydrated in fixed, boundary-aligned chunks so that scrolling
 * reuses cached results instead of refetching a sliding window. Chunk `c`
 * is exactly `query_media` at `offset = c * CHUNK_SIZE`, which lines up
 * with `useMediaIndex` because both compose the same filters and sort.
 */
export const CHUNK_SIZE = 200;

/**
 * The `MediaItem`s covering `range`, as a sparse array indexed **parallel
 * to the timeline index** — a tile at index N reads `items[N]` with no
 * offset arithmetic at the call site, and `undefined` simply means "not
 * hydrated yet".
 */
export function useMediaChunks(range: { start: number; end: number }): (MediaItem | undefined)[] {
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
    (results: UseQueryResult<MediaItem[], Error>[]): (MediaItem | undefined)[] => {
      const items: (MediaItem | undefined)[] = [];
      results.forEach((result, i) => {
        const base = chunkIndices[i] * CHUNK_SIZE;
        result.data?.forEach((item, j) => {
          items[base + j] = item;
        });
      });
      return items;
    },
    [chunkIndices],
  );

  return useQueries({
    queries: chunkIndices.map((chunk) => ({
      // Nested under "media" for the same reason as `useMediaIndex`'s key:
      // an `invalidateQueries({ queryKey: ["media"] })` anywhere in the app
      // must refetch the hydrated rows too, not just the index.
      queryKey: ["media", "chunk", typeFilter, sort, missingOnly, searchQuery, tagId, chunk],
      queryFn: () =>
        queryMedia(
          buildQuery(
            { typeFilter, sort, missingOnly, query: searchQuery, tagId },
            CHUNK_SIZE,
            chunk * CHUNK_SIZE,
          ),
        ),
      staleTime: 5 * 60 * 1000,
    })),
    combine,
  });
}
