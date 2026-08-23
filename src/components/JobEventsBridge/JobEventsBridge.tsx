import { useQueryClient } from "@tanstack/react-query";
import { useTauriEvent } from "@/lib/hooks/useTauriEvent";
import { jobLabel, useJobsStore } from "@/lib/jobs/jobsStore";
import { onTerminalEvent } from "@/lib/jobs/onTerminalEvent";
import { startSidecarSyncAll } from "@/lib/api/sidecars";
import type { JobEvent } from "@/lib/api/scan";

/**
 * Fire-and-forget sweep for any drive with pending tag changes to flush to
 * XMP sidecars. Triggered after a scan finishes (freshly imported sidecar
 * tags, or catalog tags accumulated while offline, may now be pending) and
 * whenever the set of known drives changes (a drive coming back online may
 * carry pending rows from before). Errors are swallowed — this is a
 * background nicety, not a user-initiated action with anything to report;
 * a failed sweep just retries on the next trigger.
 */
function triggerSidecarSync(): void {
  startSidecarSyncAll().catch(() => {});
}

/**
 * Renderless, mounted exactly once in `AppShell` — the single place the
 * app subscribes to the `"job"` Tauri event, so progress keeps tracking
 * (and completion gets toasted) no matter which page is on screen,
 * instead of only while `DrivesPage` happens to be mounted. Every event
 * is applied to `useJobsStore`; a terminal one (`finished`/`cancelled`)
 * is also handed to `onTerminalEvent` for query invalidation + a toast.
 *
 * Also owns the sidecar-sync sweep trigger (see [`triggerSidecarSync`]) —
 * this is as good a single, always-mounted place for it as the job event
 * subscription itself.
 */
export function JobEventsBridge() {
  const queryClient = useQueryClient();
  const applyEvent = useJobsStore((s) => s.applyEvent);

  useTauriEvent<JobEvent>("job", (event) => {
    applyEvent(event);
    onTerminalEvent(event, queryClient, jobLabel(event.job_id, useJobsStore.getState().labels));

    if (event.kind === "finished" && event.job_id.startsWith("scan-")) {
      triggerSidecarSync();
    }
  });

  useTauriEvent("drives:changed", () => {
    triggerSidecarSync();
  });

  return null;
}
