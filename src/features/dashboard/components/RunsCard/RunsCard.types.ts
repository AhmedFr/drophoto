import type { JobRun } from "@/lib/api/metrics";
import type { Drive } from "@/lib/api/drives";

export type RunsCardProps = {
  /** Most-recent-first, as returned by `listJobRuns` — only the first `RUNS_SHOWN` are rendered. */
  runs: JobRun[];
  /** Used to resolve `run.drive_id` to a drive name; a run with no match (drive deleted, or a global job) shows its kind alone. */
  drives: Drive[];
};
