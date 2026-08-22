import { useInfiniteQuery } from "@tanstack/react-query";
import { queryMedia } from "@/lib/api/media";
import { buildQuery, useGalleryStore } from "../store/galleryStore";

export const PAGE_SIZE = 500;

export function useMediaInfinite() {
  const typeFilter = useGalleryStore((s) => s.typeFilter);
  const sort = useGalleryStore((s) => s.sort);

  const query = useInfiniteQuery({
    queryKey: ["media", typeFilter, sort],
    queryFn: ({ pageParam }) => queryMedia(buildQuery({ typeFilter, sort }, PAGE_SIZE, pageParam)),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => (lastPage.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE),
  });

  return {
    items: query.data?.pages.flat() ?? [],
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isError: query.isError,
    error: query.error,
    isSuccess: query.isSuccess,
  };
}
