import { useJobsStore } from "@/lib/jobs/jobsStore";
import type { JobEvent } from "@/lib/api/scan";

/**
 * Selects the latest `JobEvent` per `job_id` from the global `jobsStore`.
 *
 * This used to own its own `"job"` Tauri listener (and drive query
 * invalidation directly), which meant its state — and any in-progress
 * scan/organize/revert display — was lost the moment `DrivesPage`
 * unmounted. `JobEventsBridge`, mounted once in `AppShell`, is now the
 * only thing that listens for `"job"` events and applies them to the
 * store; this hook just reads from it, so callers (`DrivesPage`,
 * `useOrganizeRun`, `useRevertRun`, `useRevertRow`, ...) keep working
 * unchanged no matter which page mounted first.
 */
export function useJobEvents(): Record<string, JobEvent> {
  return useJobsStore((s) => s.events);
}
