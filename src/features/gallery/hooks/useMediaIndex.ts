import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { mediaIndex, type MediaIndexEntry } from "@/lib/api/media";
import { buildQuery, filterKey, useGalleryStore } from "../store/galleryStore";

/** Stable identity so `buildLayout`'s memo doesn't rerun on every render. */
const EMPTY: MediaIndexEntry[] = [];

/**
 * The whole filtered set as compact entries — the gallery's timeline.
 *
 * Fetched in parallel with the first hydration chunk (see
 * `useMediaChunks`), never in front of it: the grid paints from chunk 0 as
 * fast as it ever did, and the scrubber and cross-library selection light
 * up when this lands a beat later. Measured at ~30 ms for 17k rows.
 *
 * `limit`/`offset` are placeholders here — `media_index` ignores both by
 * design and always returns the whole set. `sort` is *not* a placeholder:
 * chunked hydration relies on index position N being the row `query_media`
 * returns at `offset = N`, which only holds while both compose the same
 * filters and the same ordering.
 *
 * Returns the `key` (see `filterKey`) the entries actually belong to,
 * which is *not* necessarily the current selection: `keepPreviousData`
 * holds the outgoing set through a settle so the grid doesn't flash empty
 * mid-search. `GalleryPage` pairs it against `useMediaChunks`' key so a
 * thumbnail is never painted onto a tile from a different generation.
 */
export function useMediaIndex() {
  const typeFilter = useGalleryStore((s) => s.typeFilter);
  const sort = useGalleryStore((s) => s.sort);
  const missingOnly = useGalleryStore((s) => s.missingOnly);
  const searchQuery = useGalleryStore((s) => s.query);
  const tagId = useGalleryStore((s) => s.tagId);

  const query = useQuery({
    // Nested under "media" (not a flat "media-index") so the app's existing
    // `invalidateQueries({ queryKey: ["media"] })` calls — after a tag, a
    // place override, a revert, a scan, a date recovery — keep refreshing
    // the gallery. Same reasoning as `PlacesPage`'s ["media", "place", id].
    queryKey: ["media", "index", typeFilter, sort, missingOnly, searchQuery, tagId],
    queryFn: async () => {
      const filters = { typeFilter, sort, missingOnly, query: searchQuery, tagId };
      return { key: filterKey(filters), entries: await mediaIndex(buildQuery(filters, 0, 0)) };
    },
    placeholderData: keepPreviousData,
  });

  return {
    entries: query.data?.entries ?? EMPTY,
    /** The generation `entries` describes, or `null` while there is none. */
    key: query.data?.key ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
