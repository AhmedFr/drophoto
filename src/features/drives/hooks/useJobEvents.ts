import { useEffect, useState } from "react";
import { onJobEvent } from "@/lib/api/scan";
import type { JobEvent } from "@/lib/api/scan";

/**
 * Tracks the latest `JobEvent` per `job_id`. `progress` events can arrive
 * out of order (concurrent scan workers each report their own `done`
 * count); when that happens, the higher `done` value is kept rather than
 * letting a stale, lower one overwrite it.
 */
export function useJobEvents(): Record<string, JobEvent> {
  const [events, setEvents] = useState<Record<string, JobEvent>>({});

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    onJobEvent((event) => {
      setEvents((prev) => {
        const current = prev[event.job_id];
        if (
          event.kind === "progress" &&
          current?.kind === "progress" &&
          event.done < current.done
        ) {
          return prev;
        }
        return { ...prev, [event.job_id]: event };
      });
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return events;
}
