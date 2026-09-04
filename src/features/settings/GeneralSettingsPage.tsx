import { PREVIEW_EDGES } from "@/lib/api/settings";
import { UpdatesSection } from "./components/UpdatesSection";
import { QualityPicker } from "./components/QualityPicker";
import { useGeneralSettingsData } from "./hooks/useGeneralSettingsData";
import { useUpdater } from "./hooks/useUpdater";

/** Settings' "General" group: app updates, and preview quality. */
export function GeneralSettingsPage() {
  const {
    settings,
    settingsLoading,
    settingsError,
    previewsBytes,
    applyQuality,
    applyingQuality,
    regenApplicable,
    startRegen,
    regenRunning,
  } = useGeneralSettingsData();
  const updater = useUpdater();

  return (
    <div className="flex flex-col">
      <UpdatesSection {...updater} />

      {settingsError && <p className="px-6 pb-2 font-mono text-[11px] text-red-400">{settingsError}</p>}

      {!settingsLoading && (
        <QualityPicker
          currentEdge={settings?.preview_edge ?? PREVIEW_EDGES.max}
          previewsBytes={previewsBytes}
          applying={applyingQuality}
          onApply={applyQuality}
          regenApplicable={regenApplicable}
          regenRunning={regenRunning}
          onRegen={startRegen}
        />
      )}
    </div>
  );
}
