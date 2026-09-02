import type { Drive } from "@/lib/api/drives";

export type RemoveMissingDialogProps = {
  /** The drive being confirmed against — the dialog is open iff this is non-null, mirroring `ForgetDriveDialog`. */
  drive: Drive | null;
  /** `count_missing_media`'s result for `drive`, or `null` while still loading. */
  missingCount: number | null;
  /** `count_missing_media`'s rejection message, if the count query failed — the dialog still lets the user confirm (the catalog delete itself is what actually matters), just without a number to show. */
  missingCountError: string | null;
  /** Whether `remove_missing_media` is currently in flight. */
  removing: boolean;
  /** `remove_missing_media`'s rejection message, if the last attempt failed — the dialog stays open so the user can see it and retry. */
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};
