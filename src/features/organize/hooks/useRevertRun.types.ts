export type UseRevertRunResult = {
  /** Starts reverting `jobIds` in sequence. A no-op if already running or `jobIds` is empty. */
  start: () => void;
  /** True from `start()` until every job id has finished/cancelled reverting. */
  running: boolean;
  /** True once every job id has been reverted (successfully or not). */
  done: boolean;
  /** Progress of the job currently being reverted, if it has reported one. */
  progress: { done: number; total: number } | null;
  /**
   * Items that finished a job's `finished` event still reporting
   * `failed`, summed across every job id in the sequence. `done &&
   * failed === 0` is the only "fully reverted" signal — a nonzero value
   * means the run finished but left something un-reverted, and the
   * action should stay available to retry.
   */
  failed: number;
  /** The message from a failed `revert_organize` call, if any. */
  error: string | null;
};
