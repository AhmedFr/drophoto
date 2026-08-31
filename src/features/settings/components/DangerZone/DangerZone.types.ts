export type DangerZoneProps = {
  onConfirmReset: () => void;
  /** Whether `reset_app_data` is in flight — forwarded to the confirmation dialog. */
  resetting: boolean;
  /** `reset_app_data`'s rejection message, if the last attempt failed — forwarded to the confirmation dialog. */
  resetError: string | null;
};
