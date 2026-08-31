import { PageHeader } from "@/components/PageHeader";
import { PREVIEW_EDGES } from "@/lib/api/settings";
import { StorageSection } from "./components/StorageSection";
import { QualityPicker } from "./components/QualityPicker";
import { DangerZone } from "./components/DangerZone";
import { useSettingsData } from "./hooks/useSettingsData";

export function SettingsPage() {
  const {
    settings,
    settingsLoading,
    settingsError,
    storage,
    storageLoading,
    storageError,
    storageRefreshing,
    refreshStorage,
    applyQuality,
    applyingQuality,
    regenApplicable,
    startRegen,
    regenRunning,
    confirmResetAppData,
    resetting,
    resetError,
  } = useSettingsData();

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />
      <div className="flex-1 overflow-y-auto">
        <StorageSection
          usage={storage}
          loading={storageLoading}
          error={storageError}
          refreshing={storageRefreshing}
          onRefresh={refreshStorage}
        />

        {settingsError && <p className="px-6 pb-2 font-mono text-[11px] text-red-400">{settingsError}</p>}

        {!settingsLoading && (
          <QualityPicker
            currentEdge={settings?.preview_edge ?? PREVIEW_EDGES.max}
            previewsBytes={storage?.previews_bytes ?? null}
            applying={applyingQuality}
            onApply={applyQuality}
            regenApplicable={regenApplicable}
            regenRunning={regenRunning}
            onRegen={startRegen}
          />
        )}

        <DangerZone onConfirmReset={confirmResetAppData} resetting={resetting} resetError={resetError} />
      </div>
    </div>
  );
}
