import { invokeApi } from "./client";

export type JobEvent =
  | { kind: "started"; job_id: string }
  | { kind: "progress"; job_id: string; done: number; total: number; current: string | null }
  | { kind: "item_error"; job_id: string; path: string; code: string; message: string }
  | { kind: "finished"; job_id: string; ok: number; failed: number; skipped: number }
  | { kind: "cancelled"; job_id: string; ok: number; failed: number; skipped: number };

/**
 * Starts a scan of `driveId`. Incremental by default: unchanged files
 * (matching stat size/mtime, thumbnails already on disk) are skipped
 * without re-hashing — see `dp_jobs::ScanJob`. `full: true` bypasses that
 * skip index entirely, re-hashing and re-thumbnailing every file.
 */
export const startScan = (driveId: number, full = false) =>
  invokeApi<string>("start_scan", { driveId, full });

export const cancelJob = (jobId: string) => invokeApi<void>("cancel_job", { jobId });
