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
  /**
   * The most recent revert attempt's failure, if any: either the
   * `revert_organize` call itself errored, or it ran but finished with
   * some items still failed. `jobId` identifies which row it belongs to
   * — `RecentJobs` only renders it on that row. Cleared the moment a
   * fresh attempt is confirmed.
   */
  revertError: { jobId: number; message: string } | null;
};
