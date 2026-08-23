export type DoneOverlayProps = {
  moved: number;
  skipped: number;
  failed: number;
  /** The active drive's `file_tpl`, shown as "Renamed to {fileTpl}". */
  fileTpl: string;
  /** Destination folders the run filed photos into; only the first three are shown. */
  folders: string[];
  /** Shown next to "Filed into…" while `folders` is still the pre-run plan, not the confirmed result. */
  foldersHint?: string | null;
  /** True when the run stopped because the user cancelled it — the overlay then reports what was filed *before* cancelling, never a success. */
  cancelled?: boolean;
  /**
   * Called when the user confirms reverting this run in the confirmation
   * dialog. Omit to hide the REVERT button entirely (e.g. before the
   * run's job ids have resolved).
   */
  onRevert?: () => void;
  /** True while a triggered revert is in progress. */
  reverting?: boolean;
  /** Progress of the in-flight revert, if it has reported one. */
  revertProgress?: { done: number; total: number } | null;
  /** True once the revert has completed — replaces the REVERT button with a note. */
  reverted?: boolean;
  /**
   * A message to show inline (in red) below the actions: either the
   * `revert_organize` call's own error, or a summary of items that
   * finished the revert but still failed. Showing this never implies
   * `reverted` — the REVERT button stays available so the user can
   * retry.
   */
  revertError?: string | null;
};
