import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { startOrganize } from "@/lib/api/organize";
import { cancelJob, type JobEvent } from "@/lib/api/scan";
import { useJobEvents } from "@/features/drives/hooks/useJobEvents";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import type { OrganizeRunTotals, UseOrganizeRunResult } from "./useOrganizeRun.types";

const EMPTY_TOTALS: OrganizeRunTotals = { moved: 0, skipped: 0, failed: 0 };

/**
 * Runs `start_organize` for each of `driveIds` in turn: only the next
 * drive's job is started once the current one's `job` event stream
 * reports `finished` or `cancelled` (tracked via `useJobEvents`, which
 * keeps the latest event per `job_id`), accumulating `finished` totals
 * across every drive. Exposes the currently running job's progress (if
 * it has reported one) for the wizard footer.
 *
 * `cancel()` stops the *whole* run, not just the current drive's job: a
 * `cancelRequested` ref (set the moment `cancel()` is called, not only
 * once the `cancelled` event arrives — the event can lag) short-circuits
 * `advanceQueue` so no further drive is started once the in-flight job
 * settles, however it settles.
 *
 * `driveNames` (drive id -> name), when the caller has it handy, is
 * recorded as each job's label in the global `jobsStore` — so the
 * sidebar's `ActiveJobs` strip and the terminal-event toast can show the
 * drive name instead of falling back to just "Organize".
 */
export function useOrganizeRun(driveIds: number[], driveNames?: Record<number, string>): UseOrganizeRunResult {
  const queryClient = useQueryClient();
  const events = useJobEvents();

  const [queue, setQueue] = useState<number[]>([]);
  const [index, setIndex] = useState(0);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [totals, setTotals] = useState<OrganizeRunTotals>(EMPTY_TOTALS);
  const [error, setError] = useState<string | null>(null);

  // Guards against double-handling the same terminal event: `events`
  // updates trigger this effect again on every unrelated event too
  // (any job, not just this one), and `finished`/`cancelled` remain the
  // latest event for a job id once it arrives.
  const handledJobIds = useRef<Set<string>>(new Set());

  // Set the instant `cancel()` is called, independent of whether/when
  // the `cancelled` job event actually arrives — `advanceQueue` checks
  // this (not just `event.kind === "cancelled"`) so a run stops even if
  // the current job happens to report `finished` right after a cancel
  // was requested.
  const cancelRequested = useRef(false);

  const startDrive = useCallback(
    async (driveId: number) => {
      try {
        const jobId = await startOrganize(driveId);
        setCurrentJobId(jobId);
        const name = driveNames?.[driveId];
        if (name) useJobsStore.getState().setLabel(jobId, name);
      } catch (e) {
        setRunning(false);
        setError(e instanceof ApiError ? e.message : "Failed to start the organize job.");
      }
    },
    [driveNames],
  );

  const start = useCallback(() => {
    if (running || driveIds.length === 0) return;
    handledJobIds.current = new Set();
    cancelRequested.current = false;
    setQueue(driveIds);
    setIndex(0);
    setTotals(EMPTY_TOTALS);
    setDone(false);
    setCancelled(false);
    setError(null);
    setRunning(true);
    void startDrive(driveIds[0]);
  }, [driveIds, running, startDrive]);

  const cancel = useCallback(() => {
    cancelRequested.current = true;
    if (currentJobId) void cancelJob(currentJobId);
  }, [currentJobId]);

  const currentEvent = currentJobId ? events[currentJobId] : undefined;

  // Advances past the just-finished/cancelled job: accumulates its
  // totals and either starts the next drive's job or wraps up the run —
  // stopping for good, without starting any further drive, once either
  // this job itself was cancelled or `cancel()` was called at any point
  // during the run. Kept as its own callback (rather than inlined in the
  // effect below) so its `setState` calls aren't flagged as happening
  // directly inside an effect body — the effect itself only decides
  // *whether* to call this, deferring the actual state updates to this
  // nested scope, the same shape `startDrive`'s already-async state
  // updates take.
  const advanceQueue = useCallback(
    (event: JobEvent, currentIndex: number, currentQueue: number[]) => {
      if (event.kind === "finished") {
        setTotals((t) => ({
          moved: t.moved + event.ok,
          skipped: t.skipped + event.skipped,
          failed: t.failed + event.failed,
        }));
      }

      const stopped = event.kind === "cancelled" || cancelRequested.current;
      const nextIndex = currentIndex + 1;
      if (!stopped && nextIndex < currentQueue.length) {
        setIndex(nextIndex);
        void startDrive(currentQueue[nextIndex]);
      } else {
        setRunning(false);
        setDone(true);
        setCancelled(stopped);
        setCurrentJobId(null);
        queryClient.invalidateQueries({ queryKey: ["plan", driveIds] });
      }
    },
    [startDrive, queryClient, driveIds],
  );

  useEffect(() => {
    if (!currentJobId || !currentEvent) return;
    if (currentEvent.kind !== "finished" && currentEvent.kind !== "cancelled") return;
    if (handledJobIds.current.has(currentJobId)) return;
    handledJobIds.current.add(currentJobId);

    advanceQueue(currentEvent, index, queue);
  }, [currentJobId, currentEvent, index, queue, advanceQueue]);

  const progress =
    currentEvent && currentEvent.kind === "progress"
      ? { done: currentEvent.done, total: currentEvent.total }
      : null;

  return { start, cancel, running, currentJobId, progress, done, cancelled, totals, error };
}
