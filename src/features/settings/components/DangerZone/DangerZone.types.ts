export type DangerZoneProps = {
  onConfirmReset: () => void;
  /** Whether `reset_app_data` is in flight — forwarded to the confirmation dialog. */
  resetting: boolean;
};
