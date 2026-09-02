import { PageHeader } from "@/components/PageHeader";
import { PREVIEW_EDGES } from "@/lib/api/settings";
import { UpdatesSection } from "./components/UpdatesSection";
import { StorageSection } from "./components/StorageSection";
import { ToolsSection } from "./components/ToolsSection";
import { SidecarsSection } from "./components/SidecarsSection";
import { CacheLocationSection } from "./components/CacheLocationSection";
import { QualityPicker } from "./components/QualityPicker";
import { DangerZone } from "./components/DangerZone";
import { useSettingsData } from "./hooks/useSettingsData";
import { useUpdater } from "./hooks/useUpdater";

export function SettingsPage() {
  const {
    settings,
    settingsLoading,
    settingsError,
    tools,
    toolsLoading,
    toolsError,
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
    confirmUninstall,
    uninstalling,
    uninstallError,
  } = useSettingsData();
  const updater = useUpdater();

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />
      <div className="flex-1 overflow-y-auto">
        <UpdatesSection {...updater} />

        <StorageSection
          usage={storage}
          loading={storageLoading}
          error={storageError}
          refreshing={storageRefreshing}
          onRefresh={refreshStorage}
        />

        <CacheLocationSection />

        <ToolsSection tools={tools} loading={toolsLoading} error={toolsError} />

        <SidecarsSection />

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

        <DangerZone
          onConfirmReset={confirmResetAppData}
          resetting={resetting}
          resetError={resetError}
          onConfirmUninstall={confirmUninstall}
          uninstalling={uninstalling}
          uninstallError={uninstallError}
        />
      </div>
    </div>
  );
}
