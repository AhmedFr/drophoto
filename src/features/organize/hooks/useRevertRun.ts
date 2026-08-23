import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { revertOrganize } from "@/lib/api/organize";
import { useJobEvents } from "@/features/drives/hooks/useJobEvents";
import type { JobEvent } from "@/lib/api/scan";
import type { UseRevertRunResult } from "./useRevertRun.types";

/**
 * Reverts every one of `jobIds` (the numeric `organize_jobs.id`s an
 * organize run just created — see `useDoneSummary`) in sequence: only
 * the next job's revert is started once the current one's `job` event
 * stream reports `finished`/`cancelled`. Mirrors `useOrganizeRun`'s
 * queue-of-drives shape, just for the "undo" direction and without a
 * cancel affordance (a revert is itself already the "I changed my mind"
 * action).
 */
export function useRevertRun(jobIds: number[]): UseRevertRunResult {
  const queryClient = useQueryClient();
  const events = useJobEvents();

  const [index, setIndex] = useState(0);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Items that finished a job's "finished" event still reporting `failed`
  // — accumulated across every job id in the sequence, so a caller can
  // tell "reverted everything" (`done && failed === 0`) apart from
  // "reverted, but not all of it" (`done && failed > 0`), the latter of
  // which must leave the action retryable rather than reading as success.
  const [failed, setFailed] = useState(0);

  // Guards against double-handling the same terminal event, the same
  // way `useOrganizeRun` does.
  const handledJobIds = useRef<Set<string>>(new Set());

  const startAt = useCallback(async (i: number) => {
    try {
      const runnerJobId = await revertOrganize(jobIds[i]);
      setCurrentJobId(runnerJobId);
    } catch (e) {
      setRunning(false);
      setError(e instanceof ApiError ? e.message : "Failed to revert the organize job.");
    }
  }, [jobIds]);

  const start = useCallback(() => {
    if (running || jobIds.length === 0) return;
    handledJobIds.current = new Set();
    setIndex(0);
    setDone(false);
    setError(null);
    setFailed(0);
    setRunning(true);
    void startAt(0);
  }, [running, jobIds, startAt]);

  const currentEvent = currentJobId ? events[currentJobId] : undefined;

  const advance = useCallback(
    (currentIndex: number, event: JobEvent) => {
      if (event.kind === "finished") {
        setFailed((f) => f + event.failed);
      }

      const nextIndex = currentIndex + 1;
      if (nextIndex < jobIds.length) {
        setIndex(nextIndex);
        void startAt(nextIndex);
      } else {
        setRunning(false);
        setDone(true);
        setCurrentJobId(null);
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
        queryClient.invalidateQueries({ queryKey: ["unorganized"] });
        queryClient.invalidateQueries({ queryKey: ["media"] });
        queryClient.invalidateQueries({ queryKey: ["media-count"] });
      }
    },
    [jobIds, startAt, queryClient],
  );

  useEffect(() => {
    if (!currentJobId || !currentEvent) return;
    if (currentEvent.kind !== "finished" && currentEvent.kind !== "cancelled") return;
    if (handledJobIds.current.has(currentJobId)) return;
    handledJobIds.current.add(currentJobId);

    advance(index, currentEvent);
  }, [currentJobId, currentEvent, index, advance]);

  const progress =
    currentEvent && currentEvent.kind === "progress"
      ? { done: currentEvent.done, total: currentEvent.total }
      : null;

  return { start, running, done, progress, failed, error };
}
