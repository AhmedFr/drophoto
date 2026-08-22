import { useQuery } from "@tanstack/react-query";
import { countMedia } from "@/lib/api/media";
import { buildQuery, useGalleryStore } from "../store/galleryStore";

export function useMediaCount(): number | undefined {
  const typeFilter = useGalleryStore((s) => s.typeFilter);
  const sort = useGalleryStore((s) => s.sort);

  const query = useQuery({
    queryKey: ["media-count", typeFilter, sort],
    queryFn: () => countMedia(buildQuery({ typeFilter, sort }, 1, 0)),
  });

  return query.data;
}
