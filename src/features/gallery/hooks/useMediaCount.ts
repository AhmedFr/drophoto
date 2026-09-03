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

  const query = useQuery({
    queryKey: ["media-count", typeFilter, missingOnly, tagId],
    queryFn: () => countMedia(buildQuery({ typeFilter, sort: DEFAULT_SORT, missingOnly, tagId }, 1, 0)),
  });

  return query.data;
}
