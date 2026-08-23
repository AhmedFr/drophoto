export type UseRevertRowResult = {
  /** The `organize_jobs.id` currently showing a revert confirmation dialog, if any. */
  confirmJobId: number | null;
  /** Opens the confirmation dialog for `jobId`. */
  requestRevert: (jobId: number) => void;
  /** Closes the confirmation dialog without reverting. */
  cancelRevert: () => void;
  /** Confirms the revert for the job the dialog is currently showing. */
  confirmRevert: () => void;
  /** The `organize_jobs.id` currently being reverted, if any. */
  revertingJobId: number | null;
  /** Progress of the in-flight revert, if it has reported one. */
  revertProgress: { done: number; total: number } | null;
};
