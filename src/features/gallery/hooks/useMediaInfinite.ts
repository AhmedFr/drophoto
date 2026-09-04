import { useMemo } from "react";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { queryMedia } from "@/lib/api/media";
import { buildQuery, useGalleryStore } from "../store/galleryStore";

export const PAGE_SIZE = 500;

export function useMediaInfinite() {
  const typeFilter = useGalleryStore((s) => s.typeFilter);
  const sort = useGalleryStore((s) => s.sort);
  const missingOnly = useGalleryStore((s) => s.missingOnly);
  const searchQuery = useGalleryStore((s) => s.query);
  const tagId = useGalleryStore((s) => s.tagId);

  const query = useInfiniteQuery({
    queryKey: ["media", typeFilter, sort, missingOnly, searchQuery, tagId],
    queryFn: ({ pageParam }) =>
      queryMedia(
        buildQuery({ typeFilter, sort, missingOnly, query: searchQuery, tagId }, PAGE_SIZE, pageParam),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => (lastPage.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE),
    // Carries the prior query key's pages forward as `data` while a new
    // (differently-keyed, e.g. a settled search query) fetch is in flight,
    // so the grid doesn't flash empty mid-search — same reasoning as the
    // deleted Search page's `useSearch` hook.
    placeholderData: keepPreviousData,
  });

  // Keeps a stable array reference across renders where `query.data` hasn't
  // changed, so consumers that depend on `items` by identity (e.g.
  // `VirtualGrid`'s memoized layout) don't recompute needlessly.
  const items = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);

  return {
    items,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isError: query.isError,
    error: query.error,
    isSuccess: query.isSuccess,
  };
}
