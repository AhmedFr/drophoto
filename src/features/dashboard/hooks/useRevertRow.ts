import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  const handled = useRef<Set<string>>(new Set());

  const requestRevert = useCallback((jobId: number) => setConfirmJobId(jobId), []);
  const cancelRevert = useCallback(() => setConfirmJobId(null), []);

  const confirmRevert = useCallback(() => {
    if (confirmJobId == null) return;
    const orgJobId = confirmJobId;
    setConfirmJobId(null);
    void revertOrganize(orgJobId).then(
      (runnerJobId) => setTarget({ orgJobId, runnerJobId }),
      () => {
        // No dedicated error UI for a failed revert kickoff — the row
        // simply stays revertable and the user can try again.
      },
    );
  }, [confirmJobId]);

  const currentEvent = target ? events[target.runnerJobId] : undefined;

  useEffect(() => {
    if (!target || !currentEvent) return;
    if (currentEvent.kind !== "finished" && currentEvent.kind !== "cancelled") return;
    if (handled.current.has(target.runnerJobId)) return;
    handled.current.add(target.runnerJobId);

    setTarget(null);
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
    queryClient.invalidateQueries({ queryKey: ["unorganized"] });
    queryClient.invalidateQueries({ queryKey: ["media"] });
    queryClient.invalidateQueries({ queryKey: ["media-count"] });
  }, [target, currentEvent, queryClient]);

  const revertProgress =
    target && currentEvent?.kind === "progress" ? { done: currentEvent.done, total: currentEvent.total } : null;

  return {
    confirmJobId,
    requestRevert,
    cancelRevert,
    confirmRevert,
    revertingJobId: target?.orgJobId ?? null,
    revertProgress,
  };
}
