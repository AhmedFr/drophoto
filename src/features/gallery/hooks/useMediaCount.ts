import { useQuery } from "@tanstack/react-query";
import { countMedia } from "@/lib/api/media";
import { buildQuery, DEFAULT_SORT, useGalleryStore } from "../store/galleryStore";

// Count is independent of sort order, so `sort` is deliberately excluded
// from both the query key and the query sent — using `DEFAULT_SORT` keeps
// `buildQuery`'s shape without re-querying (and re-keying the cache) every
// time the user changes sort.
export function useMediaCount(): number | undefined {
  const typeFilter = useGalleryStore((s) => s.typeFilter);
  const missingOnly = useGalleryStore((s) => s.missingOnly);
  const tagId = useGalleryStore((s) => s.tagId);
  // The search box narrows the grid, so it has to narrow the count too —
  // otherwise the toolbar keeps reporting the whole library while the user
  // looks at a handful of matches.
  const searchQuery = useGalleryStore((s) => s.query);

  const query = useQuery({
    queryKey: ["media-count", typeFilter, missingOnly, tagId, searchQuery],
    queryFn: () =>
      countMedia(
        buildQuery({ typeFilter, sort: DEFAULT_SORT, missingOnly, tagId, query: searchQuery }, 1, 0),
      ),
  });

  return query.data;
}
