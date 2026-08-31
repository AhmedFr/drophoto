export type ResetAppDataDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires once the user has typed the confirmation phrase exactly and clicked confirm. */
  onConfirm: () => void;
  /** Whether `reset_app_data` is in flight — the app is about to exit, so this mostly just disables the button to prevent a double-fire. */
  resetting: boolean;
};
