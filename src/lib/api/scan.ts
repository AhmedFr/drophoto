import { invokeApi } from "./client";

export type JobEvent =
  | { kind: "started"; job_id: string }
  | { kind: "progress"; job_id: string; done: number; total: number; current: string | null }
  | { kind: "item_error"; job_id: string; path: string; code: string; message: string }
  | { kind: "finished"; job_id: string; ok: number; failed: number; skipped: number }
  | { kind: "cancelled"; job_id: string; ok: number; failed: number; skipped: number };

/** One `scan_errors` row — mirrors `dp_core::ScanErrorRow`. `at` is an RFC3339 string. */
export type ScanErrorRow = {
  id: number;
  drive_id: number;
  path: string;
  code: string;
  message: string;
  at: string;
};

/**
 * Starts a scan of `driveId`. Incremental by default: unchanged files
 * (matching stat size/mtime, thumbnails already on disk) are skipped
 * without re-hashing — see `dp_jobs::ScanJob`. `full: true` bypasses that
 * skip index entirely, re-hashing and re-thumbnailing every file.
 */
export const startScan = (driveId: number, full = false) =>
  invokeApi<string>("start_scan", { driveId, full });

export const cancelJob = (jobId: string) => invokeApi<void>("cancel_job", { jobId });

/** How many `scan_errors` rows `driveId` currently has — cheap enough to gate the "Errors…" dropdown item on. */
export const countScanErrors = (driveId: number) =>
  invokeApi<number>("count_scan_errors", { driveId });

/** Pages `driveId`'s `scan_errors` rows, newest first — backs `ScanErrorsDialog`'s "Load more" paging. */
export const listScanErrors = (driveId: number, limit: number, offset: number) =>
  invokeApi<ScanErrorRow[]>("list_scan_errors", { driveId, limit, offset });
