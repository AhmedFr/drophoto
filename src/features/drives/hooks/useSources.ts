import { useQueries } from "@tanstack/react-query";
import { listSources } from "@/lib/api/sources";
import type { Source } from "@/lib/api/sources";

/**
 * Fetches each drive's sources (`["sources", driveId]`, shared with
 * `SourcesDialog`'s own query so a save there is picked up here too via
 * cache invalidation) and returns them keyed by drive id. Missing/loading
 * entries resolve to `[]` rather than `undefined`, so callers (chiefly
 * `DriveCard`) don't need their own fallback.
 */
export function useSources(driveIds: number[]): Record<number, Source[]> {
  const results = useQueries({
    queries: driveIds.map((id) => ({
      queryKey: ["sources", id],
      queryFn: () => listSources(id),
    })),
  });

  return driveIds.reduce<Record<number, Source[]>>((acc, id, i) => {
    acc[id] = results[i]?.data ?? [];
    return acc;
  }, {});
}
