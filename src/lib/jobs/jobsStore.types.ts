import type { JobEvent } from "@/lib/api/scan";

/** One progress reading: `done` at time `t` (ms epoch) — see `applySample`/`jobRate`. */
export type Sample = { t: number; done: number };

export type JobsState = {
  /** Latest `JobEvent` per `job_id`, across every scan/organize/revert job the app has seen since launch. */
  events: Record<string, JobEvent>;
  /** Drive name per `job_id`, set by whoever started the job (when it's cheap to do so) via `setLabel`. */
  labels: Record<string, string>;
  /** Recent progress samples per `job_id`, for `jobRate`/`etaSeconds` — see `applySample`. */
  samples: Record<string, Sample[]>;
  /** Applies `event`, keeping the out-of-order `progress` guard — see `applyJobEvent` — and updating `samples` — see `applySample`. */
  applyEvent: (event: JobEvent) => void;
  /** Records `label` (typically a drive name) for `jobId`, used alongside its kind for display. */
  setLabel: (jobId: string, label: string) => void;
  /** Drops every job whose latest event is terminal (`finished`/`cancelled`). */
  clearFinished: () => void;
};

/** A still-running job (its latest event is `started` or `progress`), as shown by `ActiveJobs`. */
export type ActiveJob = {
  jobId: string;
  /** The job's kind and (if known) drive name — see `jobLabel`. */
  label: string;
  event: Extract<JobEvent, { kind: "started" | "progress" }>;
};
