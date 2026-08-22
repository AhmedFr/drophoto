export type WizardFooterRunning = {
  done: number;
  total: number;
  onCancel: () => void;
};

export type WizardFooterProps = {
  step: 0 | 1;
  totalSteps: number;
  onBack: () => void;
  /** e.g. "CONTINUE →" on step 0, "ORGANIZE {n} →" on step 1. */
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled: boolean;
  /** Present while an organize run is in progress: shows "MOVING n / total" + a CANCEL button. */
  running?: WizardFooterRunning | null;
  /** A `start_organize` failure (e.g. "a scan job is already running"), shown inline. */
  error?: string | null;
  /** A non-error nudge, e.g. "Save the rule to apply your changes" while the primary is blocked on unsaved edits. */
  hint?: string | null;
};
