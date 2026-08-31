export type DangerZoneProps = {
  onConfirmReset: () => void;
  /** Whether `reset_app_data` is in flight — forwarded to the reset confirmation dialog. */
  resetting: boolean;
  /** `reset_app_data`'s rejection message, if the last attempt failed — forwarded to the reset confirmation dialog. */
  resetError: string | null;

  onConfirmUninstall: () => void;
  /** Whether `uninstall_app` is in flight — forwarded to the uninstall confirmation dialog. */
  uninstalling: boolean;
  /** `uninstall_app`'s rejection message, if the last attempt failed — forwarded to the uninstall confirmation dialog. */
  uninstallError: string | null;
};
