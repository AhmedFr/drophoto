import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getSettings,
  PREVIEW_EDGES,
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
 * `regenApplicable` is derived directly from `settings.preview_edge <
 * PREVIEW_EDGES.max` — durable state, not a one-shot flag set from a
 * mutation's response. It stays `true` for as long as the persisted
 * setting is below max, regardless of whether the user ever clicks
 * Regenerate, navigates away, restarts the app, or a regen run gets
 * cancelled/fails partway: there's no in-memory state to lose, and no way
 * for the affordance to silently vanish while previews could still be
 * larger than the configured edge. It only ever goes away once the
 * setting itself is raised back to max (which needs a full rescan to
 * actually take effect — see `ScanJob::with_full`).
 */
export function useSettingsData(): UseSettingsDataResult {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const storageQuery = useQuery({ queryKey: ["storage-usage"], queryFn: storageUsage });

  const applyQualityMutation = useMutation({
    mutationFn: setPreviewQuality,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const regenMutation = useMutation({ mutationFn: startRegenPreviews });
  const resetMutation = useMutation({ mutationFn: resetAppData });

  const events = useJobsStore((s) => s.events);
  const regenRunning = isRegenRunning(events);

  const settings = settingsQuery.data ?? null;
  const regenApplicable = settings !== null && settings.preview_edge < PREVIEW_EDGES.max;

  return {
    settings,
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
