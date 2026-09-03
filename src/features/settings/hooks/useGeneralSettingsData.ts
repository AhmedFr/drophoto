import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getSettings, PREVIEW_EDGES, setPreviewQuality, startRegenPreviews, storageUsage } from "@/lib/api/settings";
import type { JobEvent } from "@/lib/api/scan";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import type { UseGeneralSettingsDataResult } from "./useGeneralSettingsData.types";

/** Whether any job whose id is prefixed `"regen-"` is currently running (its latest event is `started` or `progress`). */
function isRegenRunning(events: Record<string, JobEvent>): boolean {
  return Object.entries(events).some(
    ([jobId, event]) => jobId.startsWith("regen-") && (event.kind === "started" || event.kind === "progress"),
  );
}

/**
 * Data + actions for the Settings "General" group: current app settings
 * (for the quality picker's pre-selection), the on-disk preview byte
 * count it scales its estimate from, and the preview-quality
 * apply/regen-previews actions.
 *
 * Only queries `get_settings` and `storage_usage` — not `tool_health` —
 * since General never renders `ToolsSection`; keeping this hook scoped to
 * what General actually renders avoids firing an unrelated IPC command
 * every time this group mounts.
 *
 * `regenApplicable` is derived directly from `settings.preview_edge <
 * PREVIEW_EDGES.max` — durable state, not a one-shot flag set from a
 * mutation's response. See `useSettingsData`'s prior doc comment (now
 * split across this hook and its siblings) for the full rationale.
 */
export function useGeneralSettingsData(): UseGeneralSettingsDataResult {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const storageQuery = useQuery({ queryKey: ["storage-usage"], queryFn: storageUsage });

  const applyQualityMutation = useMutation({
    mutationFn: setPreviewQuality,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  // `start_regen_previews` is refusable (`RegenJob` and `GeocodeJob` share
  // the sentinel `drive_id = 0` admission bucket, and a geocode sweep
  // auto-fires after every finished scan — see `JobEventsBridge`), so a
  // click can realistically fail with nothing else in the UI reacting
  // (`regenRunning` never flips). Toasted here — matching the error-toast
  // shape `onTerminalEvent` uses for a job's own terminal failure — since
  // there's no persistent surface (the click itself is the whole
  // interaction) worth an inline error for.
  const regenMutation = useMutation({
    mutationFn: startRegenPreviews,
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Failed to start regenerating previews.");
    },
  });

  const events = useJobsStore((s) => s.events);
  const regenRunning = isRegenRunning(events);

  const settings = settingsQuery.data ?? null;
  const regenApplicable = settings !== null && settings.preview_edge < PREVIEW_EDGES.max;

  return {
    settings,
    settingsLoading: settingsQuery.isLoading,
    settingsError: settingsQuery.error ? (settingsQuery.error as Error).message : null,

    previewsBytes: storageQuery.data?.previews_bytes ?? null,

    applyQuality: (edge) => applyQualityMutation.mutate(edge),
    applyingQuality: applyQualityMutation.isPending,
    regenApplicable,

    startRegen: () => regenMutation.mutate(),
    regenRunning,
  };
}
