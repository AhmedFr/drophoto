export type UninstallDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires once the user has typed the confirmation phrase exactly and clicked confirm. */
  onConfirm: () => void;
  /** Whether `uninstall_app` is in flight — the app is about to exit, so this mostly just disables the buttons to prevent a double-fire. */
  uninstalling: boolean;
  /** `uninstall_app`'s rejection message, if the last attempt failed (e.g. not running from an installed `.app` bundle) — the dialog stays open so the user can see it. */
  error: string | null;
};
