import type { AppSettings } from "@/lib/api/settings";

/** Data + actions for the Settings "General" group (Updates, Quality). */
export type UseGeneralSettingsDataResult = {
  settings: AppSettings | null;
  settingsLoading: boolean;
  settingsError: string | null;

  /** Current on-disk preview bytes, for the quality picker's size estimate — `null` until `storage_usage` resolves. */
  previewsBytes: number | null;

  /** Calls `set_preview_quality` with the given edge (px). */
  applyQuality: (edge: number) => void;
  applyingQuality: boolean;
  /** Durable — derived as `settings.preview_edge < PREVIEW_EDGES.max`, not a one-shot flag from a mutation response. True for as long as the persisted setting is below max, regardless of navigation, restarts, or a cancelled/failed regen run. */
  regenApplicable: boolean;

  startRegen: () => void;
  /** Whether a `regen-*` job is currently running, from the global jobs store. */
  regenRunning: boolean;
};
