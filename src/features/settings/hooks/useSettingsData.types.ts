import type { AppSettings, StorageUsage } from "@/lib/api/settings";

export type UseSettingsDataResult = {
  settings: AppSettings | null;
  settingsLoading: boolean;
  settingsError: string | null;

  storage: StorageUsage | null;
  /** True only while the *first* `storage_usage` call is in flight. */
  storageLoading: boolean;
  storageError: string | null;
  /** True while a REFRESH-triggered reload is in flight (i.e. not the first load). */
  storageRefreshing: boolean;
  refreshStorage: () => void;

  /** Calls `set_preview_quality` with the given edge (px). */
  applyQuality: (edge: number) => void;
  applyingQuality: boolean;
  /** Durable — derived as `settings.preview_edge < PREVIEW_EDGES.max`, not a one-shot flag from a mutation response. True for as long as the persisted setting is below max, regardless of navigation, restarts, or a cancelled/failed regen run. */
  regenApplicable: boolean;

  startRegen: () => void;
  /** Whether a `regen-*` job is currently running, from the global jobs store. */
  regenRunning: boolean;

  confirmResetAppData: () => void;
  resetting: boolean;
};
