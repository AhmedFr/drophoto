import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getSettings,
  resetAppData,
  setPreviewQuality,
  startRegenPreviews,
  storageUsage,
} from "@/lib/api/settings";
import type { JobEvent } from "@/lib/api/scan";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import type { UseSettingsDataResult } from "./useSettingsData.types";

/** Whether any job whose id is prefixed `"regen-"` is currently running (its latest event is `started` or `progress`). */
function isRegenRunning(events: Record<string, JobEvent>): boolean {
  return Object.entries(events).some(
    ([jobId, event]) => jobId.startsWith("regen-") && (event.kind === "started" || event.kind === "progress"),
  );
}

/**
 * Composes Settings' data: current app settings, storage usage (computed
 * once on mount, refetched only via `refreshStorage` — never polled), and
 * the preview-quality apply / regen-previews / reset-app-data actions.
 *
 * `regenApplicable` tracks whether the *last applied* quality change was a
 * downscale with cached previews worth shrinking (see
 * `set_preview_quality`'s return value) — it stays `true` for the whole
 * lifetime of a subsequently started regen sweep (so `QualityPicker` can
 * show it running/disabled), then resets to `false` once that sweep's
 * terminal event lands, since there's nothing left to reclaim.
 */
export function useSettingsData(): UseSettingsDataResult {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const storageQuery = useQuery({ queryKey: ["storage-usage"], queryFn: storageUsage });

  const [regenApplicable, setRegenApplicable] = useState(false);

  const applyQualityMutation = useMutation({
    mutationFn: setPreviewQuality,
    onSuccess: (applicable) => {
      setRegenApplicable(applicable);
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const regenMutation = useMutation({ mutationFn: startRegenPreviews });
  const resetMutation = useMutation({ mutationFn: resetAppData });

  const events = useJobsStore((s) => s.events);
  const regenRunning = isRegenRunning(events);

  // Once a regen sweep that was running finishes, there's nothing left to
  // reclaim — hide the prompt rather than leaving a stale "Regenerate
  // previews" button around.
  const wasRegenRunning = useRef(false);
  useEffect(() => {
    if (wasRegenRunning.current && !regenRunning) {
      setRegenApplicable(false);
    }
    wasRegenRunning.current = regenRunning;
  }, [regenRunning]);

  return {
    settings: settingsQuery.data ?? null,
    settingsLoading: settingsQuery.isLoading,
    settingsError: settingsQuery.error ? (settingsQuery.error as Error).message : null,

    storage: storageQuery.data ?? null,
    storageLoading: storageQuery.isLoading,
    storageError: storageQuery.error ? (storageQuery.error as Error).message : null,
    storageRefreshing: storageQuery.isFetching && !storageQuery.isLoading,
    refreshStorage: () => {
      storageQuery.refetch();
    },

    applyQuality: (edge) => applyQualityMutation.mutate(edge),
    applyingQuality: applyQualityMutation.isPending,
    regenApplicable,

    startRegen: () => regenMutation.mutate(),
    regenRunning,

    confirmResetAppData: () => resetMutation.mutate(),
    resetting: resetMutation.isPending,
  };
}
