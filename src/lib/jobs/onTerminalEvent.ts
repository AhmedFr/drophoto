import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { JobEvent } from "@/lib/api/scan";

/** Every query key a completed scan/organize/revert job could have changed the data behind. */
const INVALIDATE_KEYS: readonly (readonly string[])[] = [
  ["media"],
  ["media-count"],
  ["jobs"],
  ["unorganized"],
  ["drives"],
];

/**
 * Handles one job's terminal `JobEvent` — `finished` or `cancelled` — from
 * `JobEventsBridge`'s single global listener: invalidates every query a
 * completed job could have changed, and shows exactly one toast for it.
 * `started`/`progress`/`item_error` events are no-ops; only a job's own
 * terminal event should invalidate or toast, never a per-item one.
 *
 * A sidecar sync (`job_id` prefixed `"sidecar-"`) is a background sweep
 * nobody explicitly asked for — its own success is silent (no toast),
 * so it never interrupts whatever the user's actually doing. A failure
 * still surfaces as the usual error toast: it's the one outcome worth
 * knowing about unprompted.
 */
export function onTerminalEvent(event: JobEvent, queryClient: QueryClient, label: string): void {
  if (event.kind !== "finished" && event.kind !== "cancelled") return;

  for (const queryKey of INVALIDATE_KEYS) {
    queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }

  if (event.job_id.startsWith("sidecar-") && event.failed === 0) return;

  if (event.kind === "cancelled") {
    toast(`${label} cancelled — ${event.ok} file${event.ok === 1 ? "" : "s"} done`);
    return;
  }

  const total = event.ok + event.skipped;
  if (event.failed === 0) {
    toast.success(`${label} finished — ${total} file${total === 1 ? "" : "s"}`);
  } else {
    toast.error(`${label} finished with ${event.failed} error${event.failed === 1 ? "" : "s"}`);
  }
}
