import type { Drive } from "@/lib/api/drives";

export type ForgetDriveDialogProps = {
  /** The drive pending confirmation — the dialog is closed when this is `null`. */
  drive: Drive | null;
  /** This drive's current media count, for the "removes N photos" line. `null` while still loading (or if the count query failed — see `mediaCountError`). */
  mediaCount: number | null;
  /** The count query's error message, if it failed. When set, Confirm stays usable even though `mediaCount` is `null` — a failed count must never leave the dialog stuck on "Checking…" forever. */
  mediaCountError?: string | null;
  /** Whether `forget_drive` is in flight — disables both buttons and relabels confirm. */
  forgetting: boolean;
  /** The backend's refusal message (e.g. a job is running on this drive), if the last attempt failed. */
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  /** Fires once the user has typed the confirmation phrase exactly and clicked confirm. */
  onConfirm: () => void;
};
