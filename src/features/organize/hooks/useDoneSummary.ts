import { useQuery } from "@tanstack/react-query";
import { listJobItems, listJobs } from "@/lib/api/organize";
import { dirname } from "@/lib/organize/groupPlan";
import type { UseDoneSummaryResult } from "./useDoneSummary.types";

/** How many recent `organize_jobs` rows to scan for this run's per-drive job. */
const RECENT_JOBS_LIMIT = 50;
/** Cap on `list_job_items` rows fetched per job — plenty for deriving distinct destination folders. */
const JOB_ITEMS_LIMIT = 500;
const FOLDERS_SHOWN = 3;

/**
 * Resolves the folders an organize run *actually* filed photos into,
 * from the real `organize_items` rows of the jobs it ran — not the
 * pre-run plan, which can go stale (a name collision resolved with a
 * `_n` suffix lands a file in a different-looking name than planned;
 * every planned move for a folder could fail and leave it with zero
 * moved files).
 *
 * `start_organize`'s returned job id is an opaque runner-scoped string
 * (used only to correlate `job` events) — not the numeric
 * `organize_jobs.id` that `list_job_items` expects — so there's no
 * direct way to go from "the job(s) this run started" to their rows.
 * Instead this lists recent jobs and, for each of `driveIds`, picks the
 * one with the highest id (i.e. the one this run just created).
 */
export function useDoneSummary(driveIds: number[], enabled: boolean): UseDoneSummaryResult {
  const query = useQuery({
    queryKey: ["job-items", driveIds],
    queryFn: async () => {
      const jobs = await listJobs(RECENT_JOBS_LIMIT);

      const latestJobIdByDrive = new Map<number, number>();
      for (const job of jobs) {
        if (!driveIds.includes(job.drive_id)) continue;
        const existing = latestJobIdByDrive.get(job.drive_id);
        if (existing === undefined || job.id > existing) latestJobIdByDrive.set(job.drive_id, job.id);
      }

      const itemLists = await Promise.all(
        Array.from(latestJobIdByDrive.values()).map((jobId) => listJobItems(jobId, JOB_ITEMS_LIMIT)),
      );

      const folders = new Set<string>();
      for (const items of itemLists) {
        for (const item of items) {
          if (item.status !== "moved") continue;
          folders.add(dirname(item.new_rel_path));
        }
      }

      return Array.from(folders).sort().reverse().slice(0, FOLDERS_SHOWN);
    },
    enabled: enabled && driveIds.length > 0,
  });

  return { folders: query.data ?? [], isLoading: query.isFetching };
}
