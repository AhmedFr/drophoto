import { StorageSection } from "./components/StorageSection";
import { CacheLocationSection } from "./components/CacheLocationSection";
import { OrganizeDefaultsSection } from "./components/OrganizeDefaultsSection";
import { useStorageUsageData } from "./hooks/useStorageUsageData";

/** Settings' "Library" group: storage breakdown, cache location, and organize defaults. */
export function LibrarySettingsPage() {
  const { storage, storageLoading, storageError, storageRefreshing, refreshStorage } = useStorageUsageData();

  return (
    <div className="flex flex-col">
      <StorageSection
        usage={storage}
        loading={storageLoading}
        error={storageError}
        refreshing={storageRefreshing}
        onRefresh={refreshStorage}
      />

      <CacheLocationSection />

      <OrganizeDefaultsSection />
    </div>
  );
}
