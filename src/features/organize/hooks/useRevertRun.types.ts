export type UseRevertRunResult = {
  /** Starts reverting `jobIds` in sequence. A no-op if already running or `jobIds` is empty. */
  start: () => void;
  /** True from `start()` until every job id has finished/cancelled reverting. */
  running: boolean;
  /** True once every job id has been reverted (successfully or not). */
  done: boolean;
  /** Progress of the job currently being reverted, if it has reported one. */
  progress: { done: number; total: number } | null;
  /** The message from a failed `revert_organize` call, if any. */
  error: string | null;
};
