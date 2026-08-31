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
  /** Whether the most recently applied change was a downscale with something for a regen to reclaim — see `set_preview_quality`'s return value. Resets once a started regen sweep finishes. */
  regenApplicable: boolean;

  startRegen: () => void;
  /** Whether a `regen-*` job is currently running, from the global jobs store. */
  regenRunning: boolean;

  confirmResetAppData: () => void;
  resetting: boolean;
};
