import { DangerZone } from "./components/DangerZone";
import { useDangerZoneActions } from "./hooks/useDangerZoneActions";

/** Settings' "Danger zone" group: reset app data, and uninstall. */
export function DangerZoneSettingsPage() {
  const { confirmResetAppData, resetting, resetError, confirmUninstall, uninstalling, uninstallError } =
    useDangerZoneActions();

  return (
    <DangerZone
      onConfirmReset={confirmResetAppData}
      resetting={resetting}
      resetError={resetError}
      onConfirmUninstall={confirmUninstall}
      uninstalling={uninstalling}
      uninstallError={uninstallError}
    />
  );
}
