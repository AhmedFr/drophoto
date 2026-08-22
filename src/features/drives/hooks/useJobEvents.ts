import { useState } from "react";
import { useTauriEvent } from "@/lib/hooks/useTauriEvent";
import type { JobEvent } from "@/lib/api/scan";

/**
 * Tracks the latest `JobEvent` per `job_id`. `progress` events can arrive
 * out of order (concurrent scan workers each report their own `done`
 * count); when that happens, the higher `done` value is kept rather than
 * letting a stale, lower one overwrite it.
 */
export function useJobEvents(): Record<string, JobEvent> {
  const [events, setEvents] = useState<Record<string, JobEvent>>({});

  useTauriEvent<JobEvent>("job", (event) => {
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
