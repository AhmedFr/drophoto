export type OrganizeRunTotals = {
  moved: number;
  skipped: number;
  failed: number;
};

export type UseOrganizeRunResult = {
  start: () => void;
  cancel: () => void;
  /** True from `start()` until the last drive's job has finished/cancelled. */
  running: boolean;
  currentJobId: string | null;
  progress: { done: number; total: number } | null;
  /** True once every selected drive's job has finished/cancelled. */
  done: boolean;
  totals: OrganizeRunTotals;
  /** The message from a failed `start_organize` call, if any. */
  error: string | null;
};
