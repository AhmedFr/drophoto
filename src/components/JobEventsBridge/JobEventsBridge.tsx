import { useQueryClient } from "@tanstack/react-query";
import { useTauriEvent } from "@/lib/hooks/useTauriEvent";
import { jobLabel, useJobsStore } from "@/lib/jobs/jobsStore";
import { onTerminalEvent } from "@/lib/jobs/onTerminalEvent";
import type { JobEvent } from "@/lib/api/scan";

/**
 * Renderless, mounted exactly once in `AppShell` — the single place the
 * app subscribes to the `"job"` Tauri event, so progress keeps tracking
 * (and completion gets toasted) no matter which page is on screen,
 * instead of only while `DrivesPage` happens to be mounted. Every event
 * is applied to `useJobsStore`; a terminal one (`finished`/`cancelled`)
 * is also handed to `onTerminalEvent` for query invalidation + a toast.
 */
export function JobEventsBridge() {
  const queryClient = useQueryClient();
  const applyEvent = useJobsStore((s) => s.applyEvent);

  useTauriEvent<JobEvent>("job", (event) => {
    applyEvent(event);
    onTerminalEvent(event, queryClient, jobLabel(event.job_id, useJobsStore.getState().labels));
  });

  return null;
}
