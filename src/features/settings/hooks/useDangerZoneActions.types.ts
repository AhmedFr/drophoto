/** Actions for the Settings "Danger zone" group's reset/uninstall flows. */
export type UseDangerZoneActionsResult = {
  confirmResetAppData: () => void;
  resetting: boolean;
  /** `reset_app_data`'s rejection message, if the last attempt failed — rendered inside `ResetAppDataDialog`, which stays open. */
  resetError: string | null;

  confirmUninstall: () => void;
  uninstalling: boolean;
  /** `uninstall_app`'s rejection message, if the last attempt failed (e.g. not running from an installed `.app` bundle) — rendered inside `UninstallDialog`, which stays open. */
  uninstallError: string | null;
};
