import type { StorageUsage } from "@/lib/api/settings";

/** Data + actions for the Settings "Library" group's storage breakdown. */
export type UseStorageUsageDataResult = {
  storage: StorageUsage | null;
  /** True only while the *first* `storage_usage` call is in flight. */
  storageLoading: boolean;
  storageError: string | null;
  /** True while a REFRESH-triggered reload is in flight (i.e. not the first load). */
  storageRefreshing: boolean;
  refreshStorage: () => void;
};
