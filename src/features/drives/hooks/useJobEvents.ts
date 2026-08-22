import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTauriEvent } from "@/lib/hooks/useTauriEvent";
import type { JobEvent } from "@/lib/api/scan";

/**
 * Tracks the latest `JobEvent` per `job_id`. `progress` events can arrive
 * out of order (concurrent scan workers each report their own `done`
 * count); when that happens, the higher `done` value is kept rather than
 * letting a stale, lower one overwrite it.
 *
 * Also invalidates the gallery's `media` and `media-count` queries when a
 * job `finished`, so a completed scan's newly-cataloged (or removed) media
 * shows up without requiring a manual refresh.
 */
export function useJobEvents(): Record<string, JobEvent> {
  const queryClient = useQueryClient();
  const [events, setEvents] = useState<Record<string, JobEvent>>({});

  useTauriEvent<JobEvent>("job", (event) => {
    if (event.kind === "finished") {
      queryClient.invalidateQueries({ queryKey: ["media"] });
      queryClient.invalidateQueries({ queryKey: ["media-count"] });
    }

    setEvents((prev) => {
      const current = prev[event.job_id];
      if (event.kind === "progress" && current?.kind === "progress" && event.done < current.done) {
        return prev;
      }
      return { ...prev, [event.job_id]: event };
    });
  });

  return events;
}
