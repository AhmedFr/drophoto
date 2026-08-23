export type RevertConfirmDialogProps = {
  /** Controls whether the dialog is shown. */
  open: boolean;
  /** How many files this revert would move back — shown in the prompt. */
  moved: number;
  /** Called when the dialog should close without reverting (Cancel, overlay click, Escape). */
  onCancel: () => void;
  /** Called when the user confirms the revert. */
  onConfirm: () => void;
};
