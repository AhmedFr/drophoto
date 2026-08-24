import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchMedia } from "@/lib/api/search";

/** How long to wait, after the caller's `query` last changed, before firing the search. */
const DEBOUNCE_MS = 200;

/**
 * Debounces `query` by `DEBOUNCE_MS` and fires `searchMedia` against the
 * debounced value once it settles. Disabled (no fetch) while the trimmed
 * debounced query is empty — e.g. the caller hasn't typed anything yet, or
 * has cleared the field.
 *
 * `isDebouncing` is derived, not extra state: it's just whether the
 * debounced value has caught up with the latest `query` yet.
 */
export function useSearch(query: string) {
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const trimmed = debouncedQuery.trim();
  const isDebouncing = query !== debouncedQuery;

  const result = useQuery({
    queryKey: ["search", debouncedQuery],
    queryFn: () => searchMedia(trimmed),
    enabled: trimmed !== "",
  });

  return {
    items: result.data ?? [],
    isFetching: result.isFetching,
    isDebouncing,
  };
}
