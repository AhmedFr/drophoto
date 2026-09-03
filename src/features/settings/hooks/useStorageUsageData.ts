import { useQuery } from "@tanstack/react-query";
import { storageUsage } from "@/lib/api/settings";
import type { UseStorageUsageDataResult } from "./useStorageUsageData.types";

/**
 * Storage usage (computed once on mount, refetched only via
 * `refreshStorage` — never polled) for the Settings "Library" group's
 * `StorageSection`. Split out of the former single `useSettingsData` so
 * mounting Library doesn't also fire `get_settings`/`tool_health`, which
 * it never renders anything for.
 */
export function useStorageUsageData(): UseStorageUsageDataResult {
  const storageQuery = useQuery({ queryKey: ["storage-usage"], queryFn: storageUsage });

  return {
    storage: storageQuery.data ?? null,
    storageLoading: storageQuery.isLoading,
    storageError: storageQuery.error ? (storageQuery.error as Error).message : null,
    storageRefreshing: storageQuery.isFetching && !storageQuery.isLoading,
    refreshStorage: () => {
      storageQuery.refetch();
    },
  };
}
