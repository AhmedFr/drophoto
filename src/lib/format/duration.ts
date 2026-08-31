/**
 * Formats a duration in a compact, glanceable style: `"41m"` once minutes
 * reach double digits (seconds stop mattering at that scale), `"3m 12s"`
 * under that, `"12s"` under a minute, `"1h 20m"` at an hour or more.
 * Shared by the dashboard's "LAST RUNS" card (a finished run's elapsed
 * time) and `ActiveJobs` (a running job's ETA).
 */
export function formatDurationShort(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes >= 10) return `${minutes}m`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}
