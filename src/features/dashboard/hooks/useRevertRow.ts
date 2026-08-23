import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/client";
import { revertOrganize } from "@/lib/api/organize";
import { useJobEvents } from "@/features/drives/hooks/useJobEvents";
import type { UseRevertRowResult } from "./useRevertRow.types";

/**
 * Drives the "revert this organize job" flow for a single [`RecentJobs`]
 * row at a time: a confirmation step (`confirmJobId`), then the actual
 * `revert_organize` call and its progress (tracked via `useJobEvents`,
 * the same "job" event stream every other job kind uses), invalidating
 * the dashboard's own queries plus the gallery's once the revert job
 * reaches a terminal state.
 */
export function useRevertRow(): UseRevertRowResult {
  const queryClient = useQueryClient();
  const events = useJobEvents();

  const [confirmJobId, setConfirmJobId] = useState<number | null>(null);
  const [target, setTarget] = useState<{ orgJobId: number; runnerJobId: string } | null>(null);
  const [revertError, setRevertError] = useState<{ jobId: number; message: string } | null>(null);
  const handled = useRef<Set<string>>(new Set());

  const requestRevert = useCallback((jobId: number) => setConfirmJobId(jobId), []);
  const cancelRevert = useCallback(() => setConfirmJobId(null), []);

  const confirmRevert = useCallback(() => {
    if (confirmJobId == null) return;
    const orgJobId = confirmJobId;
    setConfirmJobId(null);
    // A fresh attempt supersedes whatever this row's last attempt
    // reported — clear it now rather than leaving a stale message up
    // while the new one is in flight.
    setRevertError(null);
    void revertOrganize(orgJobId).then(
      (runnerJobId) => setTarget({ orgJobId, runnerJobId }),
      (e) => {
        setRevertError({
          jobId: orgJobId,
          message: e instanceof ApiError ? e.message : "Failed to revert the organize job.",
        });
      },
    );
  }, [confirmJobId]);

  const currentEvent = target ? events[target.runnerJobId] : undefined;

  // The effect below only decides *whether* to settle; the actual
  // `setState`/invalidation calls live here, in an ordinary callback it
  // invokes — keeping the effect body itself free of direct `setState`
  // calls (same shape `useOrganizeRun`/`useRevertRun`'s `advance` takes).
  const settle = useCallback(
    (event: Extract<typeof currentEvent, { kind: "finished" | "cancelled" }>, orgJobId: number) => {
      // `reverted_by_job_id` only ever reflects a fully-successful revert
      // (see `dp_catalog::organize_jobs`'s `REVERTED_BY_SUBQUERY`) — a
      // `finished` event that still reports `failed` items left the job
      // retryable, so surface that explicitly rather than letting the
      // row silently drop back to "revertable" with no explanation.
      if (event.kind === "finished" && event.failed > 0) {
        const n = event.failed;
        setRevertError({
          jobId: orgJobId,
          message: `REVERT FAILED — ${n} file${n === 1 ? "" : "s"} could not be moved back`,
        });
      }

      setTarget(null);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["unorganized"] });
      queryClient.invalidateQueries({ queryKey: ["media"] });
      queryClient.invalidateQueries({ queryKey: ["media-count"] });
    },
    [queryClient],
  );

  useEffect(() => {
    if (!target || !currentEvent) return;
    if (currentEvent.kind !== "finished" && currentEvent.kind !== "cancelled") return;
    if (handled.current.has(target.runnerJobId)) return;
    handled.current.add(target.runnerJobId);

    settle(currentEvent, target.orgJobId);
  }, [target, currentEvent, settle]);

  const revertProgress =
    target && currentEvent?.kind === "progress" ? { done: currentEvent.done, total: currentEvent.total } : null;

  return {
    confirmJobId,
    requestRevert,
    cancelRevert,
    confirmRevert,
    revertingJobId: target?.orgJobId ?? null,
    revertProgress,
    revertError,
  };
}
