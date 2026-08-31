import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listDrives } from "@/lib/api/drives";
import { listJobRuns } from "@/lib/api/metrics";
import { listJobs, listUnorganizedSummaries } from "@/lib/api/organize";
import { countMedia, type MediaKind, type MediaQuery } from "@/lib/api/media";
import type { JobEvent } from "@/lib/api/scan";
import { useTauriEvent } from "@/lib/hooks/useTauriEvent";
import type { UseDashboardResult } from "./useDashboard.types";

const RECENT_JOBS_LIMIT = 10;
const RECENT_RUNS_LIMIT = 8;

function kindQuery(kind: MediaKind): MediaQuery {
  return { kinds: [kind], exts: [], sort: "taken_desc", limit: 1, offset: 0 };
}

/**
 * Composes the dashboard's four data sources (drives, recent organize jobs,
 * unorganized summaries, and photo/video counts) into one result, and keeps
 * them fresh: a finished or cancelled organize job invalidates the job list,
 * the unorganized summaries, and the media kind counts (organizing changes
 * what's left unorganized but not the total photo/video count, so the kind
 * counts are invalidated too rather than assumed unaffected); a
 * `drives:changed` event invalidates the drive list (capacity/online state).
 */
export function useDashboard(): UseDashboardResult {
  const queryClient = useQueryClient();

  const drivesQuery = useQuery({ queryKey: ["drives"], queryFn: listDrives });
  const jobsQuery = useQuery({ queryKey: ["jobs"], queryFn: () => listJobs(RECENT_JOBS_LIMIT) });
  const runsQuery = useQuery({ queryKey: ["jobRuns"], queryFn: () => listJobRuns(RECENT_RUNS_LIMIT) });
  const summariesQuery = useQuery({ queryKey: ["unorganized"], queryFn: listUnorganizedSummaries });
  const photosQuery = useQuery({
    queryKey: ["media-count-kind", "photo"],
    queryFn: () => countMedia(kindQuery("photo")),
  });
  const videosQuery = useQuery({
    queryKey: ["media-count-kind", "video"],
    queryFn: () => countMedia(kindQuery("video")),
  });

  useTauriEvent<JobEvent>("job", (event) => {
    if (event.kind === "finished" || event.kind === "cancelled") {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["jobRuns"] });
      queryClient.invalidateQueries({ queryKey: ["unorganized"] });
      queryClient.invalidateQueries({ queryKey: ["media-count-kind"] });
    }
  });

  useTauriEvent("drives:changed", () => {
    queryClient.invalidateQueries({ queryKey: ["drives"] });
  });

  const summaries = summariesQuery.data ?? [];
  const unorganizedCount = summaries.reduce((sum, s) => sum + s.count, 0);

  const firstError =
    drivesQuery.error ??
    jobsQuery.error ??
    runsQuery.error ??
    summariesQuery.error ??
    photosQuery.error ??
    videosQuery.error ??
    null;

  return {
    drives: drivesQuery.data ?? [],
    jobs: jobsQuery.data ?? [],
    runs: runsQuery.data ?? [],
    photoCount: photosQuery.data ?? 0,
    videoCount: videosQuery.data ?? 0,
    unorganizedCount,
    isLoading:
      drivesQuery.isLoading || jobsQuery.isLoading || runsQuery.isLoading || summariesQuery.isLoading ||
      photosQuery.isLoading || videosQuery.isLoading,
    isError:
      drivesQuery.isError || jobsQuery.isError || runsQuery.isError || summariesQuery.isError ||
      photosQuery.isError || videosQuery.isError,
    error: firstError as Error | null,
  };
}
