import { create } from "zustand";
import type { JobEvent } from "@/lib/api/scan";
import type { ActiveJob, JobsState } from "./jobsStore.types";

/**
 * Applies `event` to `events`, keeping the guard `useJobEvents` used to
 * apply itself: a `progress` event reporting a lower `done` than the
 * currently-stored `progress` event for the same job is ignored, since
 * concurrent scan workers each report their own `done` count and can
 * race each other's events out of order.
 */
export function applyJobEvent(
  events: Record<string, JobEvent>,
  event: JobEvent,
): Record<string, JobEvent> {
  const current = events[event.job_id];
  if (event.kind === "progress" && current?.kind === "progress" && event.done < current.done) {
    return events;
  }
  return { ...events, [event.job_id]: event };
}

/** Derives a job's kind from its id prefix (`"scan-3"` → `"Scan"`, `"organize-1"` → `"Organize"`, `"revert-0"` → `"Revert"`). */
export function jobKindFromId(jobId: string): string {
  if (jobId.startsWith("scan-")) return "Scan";
  if (jobId.startsWith("organize-")) return "Organize";
  if (jobId.startsWith("revert-")) return "Revert";
  return "Job";
}

/** A job's display label: its kind, plus the drive name recorded via `setLabel` when one is known. */
export function jobLabel(jobId: string, labels: Record<string, string>): string {
  const kind = jobKindFromId(jobId);
  const drive = labels[jobId];
  return drive ? `${kind} ${drive}` : kind;
}

/** Jobs still running — i.e. whose latest event is `started` or `progress` — for `ActiveJobs`. */
export function activeJobs(state: Pick<JobsState, "events" | "labels">): ActiveJob[] {
  return Object.entries(state.events)
    .filter(
      (entry): entry is [string, Extract<JobEvent, { kind: "started" | "progress" }>] =>
        entry[1].kind === "started" || entry[1].kind === "progress",
    )
    .map(([jobId, event]) => ({ jobId, label: jobLabel(jobId, state.labels), event }));
}

/**
 * Global (non-persisted) store for every job's live status: replaces the
 * per-`DrivesPage`-mount state `useJobEvents` used to hold, so progress
 * keeps updating — and completion/failure can be toasted — no matter
 * which page is on screen. `JobEventsBridge` is the only thing that
 * calls `applyEvent`; everything else only reads.
 */
export const useJobsStore = create<JobsState>()((set) => ({
  events: {},
  labels: {},
  applyEvent: (event) => set((state) => ({ events: applyJobEvent(state.events, event) })),
  setLabel: (jobId, label) => set((state) => ({ labels: { ...state.labels, [jobId]: label } })),
  clearFinished: () =>
    set((state) => ({
      events: Object.fromEntries(
        Object.entries(state.events).filter(([, e]) => e.kind !== "finished" && e.kind !== "cancelled"),
      ),
    })),
}));
