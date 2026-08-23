import { useQueries } from "@tanstack/react-query";
import { listSources } from "@/lib/api/sources";
import type { UseSourcesResult } from "./useSources.types";

/**
 * Fetches each drive's sources (`["sources", driveId]`, shared with
 * `SourcesDialog`'s own query so a save there is picked up here too via
 * cache invalidation) and returns them keyed by drive id. Missing/loading
 * entries resolve to `[]` rather than `undefined`, so callers (chiefly
 * `DriveCard`) don't need their own fallback.
 *
 * `isLoading` exists because that `[]` fallback is indistinguishable
 * from a drive that genuinely has no sources: without it `DriveCard`
 * flashes a red "No sources" on every mount before the query resolves.
 */
export function useSources(driveIds: number[]): UseSourcesResult {
  const results = useQueries({
    queries: driveIds.map((id) => ({
      queryKey: ["sources", id],
      queryFn: () => listSources(id),
    })),
  });

  return {
    sourcesByDrive: driveIds.reduce<UseSourcesResult["sourcesByDrive"]>((acc, id, i) => {
      acc[id] = results[i]?.data ?? [];
      return acc;
    }, {}),
    isLoading: results.some((r) => r.isLoading),
  };
}
