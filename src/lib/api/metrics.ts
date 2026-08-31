import { invokeApi } from "./client";

/** One finished job's run metrics — mirrors `dp_core::JobRunRow`. */
export type JobRun = {
  id: number;
  job_id: string;
  kind: string;
  drive_id: number | null;
  status: string;
  ok: number;
  failed: number;
  skipped: number;
  bytes_read: number;
  bytes_written: number;
  cpu_ms: number;
  started_at: string;
  finished_at: string;
};

/** The most recent `limit` job runs, newest first — for the dashboard's "LAST RUNS" card. Capped server-side at 50. */
export const listJobRuns = (limit: number = 20) => invokeApi<JobRun[]>("list_job_runs", { limit });
