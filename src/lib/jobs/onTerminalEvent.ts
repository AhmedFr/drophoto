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
 * A sidecar sync (`job_id` prefixed `"sidecar-"`) is handled first and
 * quite differently, because it's a background sweep nobody explicitly
 * asked for. It writes `.xmp` files on disk, clears a flag no query here
 * reads, and can import externally-edited subjects into the catalog — so
 * only the tag queries are refreshed; refetching the whole gallery after
 * every sweep would be pure churn and is skipped. Its success is silent, so it never interrupts
 * whatever the user's actually doing; a failure still surfaces as the
 * usual error toast, the one outcome worth knowing about unprompted.
 */
export function onTerminalEvent(event: JobEvent, queryClient: QueryClient, label: string): void {
  if (event.kind !== "finished" && event.kind !== "cancelled") return;

  const isSidecarSync = event.job_id.startsWith("sidecar-");

  if (isSidecarSync) {
    // The sweep can import externally-added subjects into the catalog
    // (see `merged_names` in dp-jobs), so the tag queries — and only
    // those — are refreshed; the gallery grid itself is untouched.
    queryClient.invalidateQueries({ queryKey: ["tags"] });
    queryClient.invalidateQueries({ queryKey: ["media-tags"] });
    if (event.failed === 0) return;
  } else {
    for (const queryKey of INVALIDATE_KEYS) {
      queryClient.invalidateQueries({ queryKey: [...queryKey] });
    }
  }

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
