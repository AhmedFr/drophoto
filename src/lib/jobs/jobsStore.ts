import { create } from "zustand";
import type { JobEvent } from "@/lib/api/scan";
import type { ActiveJob, JobsState, Sample } from "./jobsStore.types";

/** How far back `applySample`/`jobRate` look for progress readings — a rate computed over a wider window goes stale (reacts too slowly to a job that's sped up or stalled). */
const SAMPLE_WINDOW_MS = 30_000;

/** Hard cap on samples kept per job, regardless of how many `progress` events land inside `SAMPLE_WINDOW_MS` — a very chatty job (many small files) must never grow this array unbounded. */
const SAMPLE_CAP = 60;

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

/** Derives a job's kind from its id prefix (`"scan-3"` → `"Scan"`, `"organize-1"` → `"Organize"`, `"revert-0"` → `"Revert"`, `"sidecar-0"` → `"Sidecar sync"`, `"geocode-0"` → `"Geocode"`, `"regen-0"` → `"Regenerate previews"`). */
export function jobKindFromId(jobId: string): string {
  if (jobId.startsWith("scan-")) return "Scan";
  if (jobId.startsWith("organize-")) return "Organize";
  if (jobId.startsWith("revert-")) return "Revert";
  if (jobId.startsWith("sidecar-")) return "Sidecar sync";
  if (jobId.startsWith("geocode-")) return "Geocode";
  if (jobId.startsWith("regen-")) return "Regenerate previews";
  return "Job";
}

/** A job's display label: its kind, plus the drive name recorded via `setLabel` when one is known. */
export function jobLabel(jobId: string, labels: Record<string, string>): string {
  const kind = jobKindFromId(jobId);
  const drive = labels[jobId];
  return drive ? `${kind} ${drive}` : kind;
}

/**
 * Updates `samples` for `event`, keyed by job id: a `progress` event
 * appends `{t: now, done: event.done}`, first pruning entries older than
 * `SAMPLE_WINDOW_MS` and then capping the result at the `SAMPLE_CAP` most
 * recent readings; a terminal event (`finished`/`cancelled`) deletes the
 * job's samples entirely, so a finished job never lingers with a stale
 * rate if its id is ever reused; any other event (`started`/`item_error`)
 * leaves `samples` unchanged.
 */
export function applySample(
  samples: Record<string, Sample[]>,
  event: JobEvent,
  now: number,
): Record<string, Sample[]> {
  if (event.kind === "finished" || event.kind === "cancelled") {
    if (!(event.job_id in samples)) return samples;
    const next = { ...samples };
    delete next[event.job_id];
    return next;
  }
  if (event.kind !== "progress") return samples;

  const cutoff = now - SAMPLE_WINDOW_MS;
  const existing = samples[event.job_id] ?? [];
  const pruned = existing.filter((s) => s.t >= cutoff);
  const next = [...pruned, { t: now, done: event.done }].slice(-SAMPLE_CAP);
  return { ...samples, [event.job_id]: next };
}

/**
 * Files/sec derived from `samples` within the last `SAMPLE_WINDOW_MS` of
 * `now`: the `done` delta between the oldest and newest reading in that
 * window, divided by the elapsed time between them. `null` when fewer
 * than two samples fall in the window (not enough to derive a rate) or
 * the elapsed time is non-positive (clock oddities, or both readings
 * landed in the same millisecond).
 */
export function jobRate(samples: Sample[], now: number): number | null {
  const cutoff = now - SAMPLE_WINDOW_MS;
  const recent = samples.filter((s) => s.t >= cutoff);
  if (recent.length < 2) return null;

  const first = recent[0];
  const last = recent[recent.length - 1];
  const elapsedSeconds = (last.t - first.t) / 1000;
  if (elapsedSeconds <= 0) return null;

  return (last.done - first.done) / elapsedSeconds;
}

/**
 * Seconds remaining to reach `total` from `done` at `rate` files/sec.
 * `null` when `rate` is `null` or non-positive (no meaningful ETA — a
 * stalled or reversing rate would otherwise produce a negative or
 * infinite estimate) or when there's nothing meaningful to count down
 * (`total <= 0`, i.e. a job that hasn't reported a total yet). `0` once
 * `done` has already reached (or passed) `total`.
 */
export function etaSeconds(rate: number | null, done: number, total: number): number | null {
  if (rate === null || rate <= 0 || total <= 0) return null;
  const remaining = total - done;
  return remaining <= 0 ? 0 : remaining / rate;
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
  samples: {},
  driveIds: {},
  applyEvent: (event) =>
    set((state) => ({
      events: applyJobEvent(state.events, event),
      samples: applySample(state.samples, event, Date.now()),
    })),
  setLabel: (jobId, label) => set((state) => ({ labels: { ...state.labels, [jobId]: label } })),
  setJobDrive: (jobId, driveId) =>
    set((state) => ({ driveIds: { ...state.driveIds, [jobId]: driveId } })),
  clearFinished: () =>
    set((state) => {
      const dropped = new Set(
        Object.entries(state.events)
          .filter(([, e]) => e.kind === "finished" || e.kind === "cancelled")
          .map(([jobId]) => jobId),
      );
      return {
        events: Object.fromEntries(Object.entries(state.events).filter(([jobId]) => !dropped.has(jobId))),
        driveIds: Object.fromEntries(
          Object.entries(state.driveIds).filter(([jobId]) => !dropped.has(jobId)),
        ),
      };
    }),
}));
