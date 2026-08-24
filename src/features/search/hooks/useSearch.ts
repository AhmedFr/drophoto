import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { searchMedia } from "@/lib/api/search";

/** How long to wait, after the caller's `query` last changed, before firing the search. */
const DEBOUNCE_MS = 200;

/**
 * Debounces `query` by `DEBOUNCE_MS` and fires `searchMedia` against the
 * debounced, trimmed value once it settles. Disabled (no fetch) while
 * that trimmed value is empty — e.g. the caller hasn't typed anything
 * yet, or has cleared the field. Keyed on the trimmed value (M4) so
 * `"beach"` and `"  beach  "` share one cache entry instead of firing a
 * redundant query.
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
    queryKey: ["search", trimmed],
    queryFn: () => searchMedia(trimmed),
    enabled: trimmed !== "",
    // M5: `keepPreviousData` carries the prior query's result set forward
    // as `data` while a new (differently-keyed) query is in flight, so a
    // settled debounce doesn't instantly blank the grid back to nothing.
    placeholderData: keepPreviousData,
  });

  const items = result.data ?? [];

  return {
    items,
    // Nothing at all to show yet — neither this query's own result nor a
    // kept-over previous result set (`items.length === 0` covers both:
    // the very first fetch, and a new query following a previous one
    // that itself had no results). A non-empty previous result set stays
    // on screen and refreshes in place instead of collapsing into a
    // spinner, mirroring the old `isPending`-not-`isFetching` reasoning
    // but generalized across a debounce-triggered query-key change too.
    isFetching: trimmed !== "" && items.length === 0 && result.isFetching,
    isDebouncing,
  };
}
