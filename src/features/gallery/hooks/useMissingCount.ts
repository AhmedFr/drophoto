import { useQuery } from "@tanstack/react-query";
import { countMedia } from "@/lib/api/media";

/**
 * How many media rows are currently marked missing, across every drive and
 * regardless of the gallery's active type filter — the toolbar's "Missing
 * (N)" chip only renders once this is nonzero, and reads it independently
 * of `useMediaCount` (whose count tracks the *currently filtered* grid, not
 * "is there anything to toggle to at all"). Deliberately not scoped by
 * `typeFilter`/`sort` — the chip's very existence shouldn't flicker in and
 * out as the user changes an unrelated filter.
 */
export function useMissingCount(): number | undefined {
  const query = useQuery({
    queryKey: ["missing-count"],
    queryFn: () => countMedia({ kinds: [], exts: [], sort: "taken_desc", limit: 1, offset: 0, missing: true }),
  });

  return query.data;
}
