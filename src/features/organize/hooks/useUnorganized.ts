import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listDrives } from "@/lib/api/drives";
import { listUnorganizedSummaries, type UnorganizedSummary } from "@/lib/api/organize";
import { countMedia, type MediaQuery } from "@/lib/api/media";
import { startScan, type JobEvent } from "@/lib/api/scan";
import { useTauriEvent } from "@/lib/hooks/useTauriEvent";
import type { UnorganizedRow, UseUnorganizedResult } from "./useUnorganized.types";

const TOTAL_MEDIA_QUERY: MediaQuery = {
  kinds: [],
  exts: [],
  sort: "taken_desc",
  limit: 1,
  offset: 0,
};

function emptySummary(driveId: number): UnorganizedSummary {
  return {
    drive_id: driveId,
    count: 0,
    total: 0,
    bytes: 0,
    photos: 0,
    videos: 0,
    earliest: null,
    latest: null,
    legacy: 0,
  };
}

/**
 * Joins online drives with their `list_unorganized_summaries` row (a drive
 * with no row yet — never scanned — gets a synthetic zero-count summary so
 * it still shows up with a "scan to index" prompt), and derives the count
 * of already-organized media (total minus unorganized minus legacy, across
 * all drives) for the Detect step's stat strip.
 */
export function useUnorganized(): UseUnorganizedResult {
  const queryClient = useQueryClient();

  const drivesQuery = useQuery({ queryKey: ["drives"], queryFn: listDrives });
  const summariesQuery = useQuery({ queryKey: ["unorganized"], queryFn: listUnorganizedSummaries });
  const totalQuery = useQuery({
    queryKey: ["media-count", "total"],
    queryFn: () => countMedia(TOTAL_MEDIA_QUERY),
  });

  // `cancelled` counts too: a cancelled scan or organize run still moved
  // (or indexed) everything it got through before stopping, so the
  // summaries on screen are just as stale as after a clean finish.
  useTauriEvent<JobEvent>("job", (event) => {
    if (event.kind === "finished" || event.kind === "cancelled") {
      queryClient.invalidateQueries({ queryKey: ["unorganized"] });
      queryClient.invalidateQueries({ queryKey: ["media-count"] });
    }
  });

  const scanMutation = useMutation({ mutationFn: (driveId: number) => startScan(driveId) });

  const drives = drivesQuery.data ?? [];
  const summaries = summariesQuery.data ?? [];
  const summariesByDrive = new Map(summaries.map((s) => [s.drive_id, s]));

  const rows: UnorganizedRow[] = drives
    .filter((d) => d.online)
    .map((d) => ({ ...(summariesByDrive.get(d.id) ?? emptySummary(d.id)), drive: d }));

  const totalUnorganized = summaries.reduce((sum, s) => sum + s.count, 0);
  // Legacy rows are neither organized nor (yet) organizable — they must
  // not fall out of `count` and land in `organizedCount` by default, or
  // the strip would claim photos are "already organized" when what's
  // really needed is a re-scan.
  const totalLegacy = summaries.reduce((sum, s) => sum + s.legacy, 0);
  const organizedCount = Math.max(0, (totalQuery.data ?? 0) - totalUnorganized - totalLegacy);

  return {
    rows,
    organizedCount,
    isLoading: drivesQuery.isLoading || summariesQuery.isLoading,
    isError: drivesQuery.isError || summariesQuery.isError,
    scan: (driveId) => scanMutation.mutate(driveId),
    scanningDriveId: scanMutation.isPending ? (scanMutation.variables ?? null) : null,
  };
}
