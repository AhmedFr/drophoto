import type { UnlistenFn } from "@tauri-apps/api/event";
import { invokeApi } from "./client";
import { onEvent } from "./events";

export type JobEvent =
  | { kind: "started"; job_id: string }
  | { kind: "progress"; job_id: string; done: number; total: number; current: string | null }
  | { kind: "item_error"; job_id: string; path: string; code: string; message: string }
  | { kind: "finished"; job_id: string; ok: number; failed: number; skipped: number }
  | { kind: "cancelled"; job_id: string };

export const startScan = (driveId: number) => invokeApi<string>("start_scan", { driveId });

export const cancelJob = (jobId: string) => invokeApi<void>("cancel_job", { jobId });

export const onJobEvent = (cb: (event: JobEvent) => void): Promise<UnlistenFn> =>
  onEvent<JobEvent>("job", cb);
