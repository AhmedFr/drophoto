import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/format/bytes";
import { formatDurationShort } from "@/lib/format/duration";
import type { JobRun } from "@/lib/api/metrics";
import type { RunsCardProps } from "./RunsCard.types";

/** Only the most recent `RUNS_SHOWN` runs are shown — this is a glance-at card, not a full history browser. */
const RUNS_SHOWN = 8;

/** `run.kind` as a short uppercase label, e.g. `"scan"` -> `"SCAN"`. */
function kindLabel(kind: string): string {
  return kind.toUpperCase();
}

/**
 * Milliseconds between `started_at` and `finished_at`, clamped to `>= 0` —
 * a run's `finished_at` should never be before `started_at`, but a value
 * that somehow inverted (clock skew, a hand-edited row) must never render
 * a negative duration.
 */
export function runDurationMs(run: Pick<JobRun, "started_at" | "finished_at">): number {
  const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

/** Files/sec over the run's duration — `null` when the duration is zero, avoiding a divide-by-zero reading as an absurd rate. */
export function runRate(run: JobRun): number | null {
  const seconds = runDurationMs(run) / 1000;
  if (seconds <= 0) return null;
  return (run.ok + run.skipped) / seconds;
}

/** The dot-joined stats line: file count (flagging failures), duration, bytes read/written, and rate. */
export function formatRunLine(run: JobRun): string {
  const parts: string[] = [];

  const files = run.ok + run.skipped;
  parts.push(
    run.failed > 0 ? `${files.toLocaleString()} files (${run.failed} failed)` : `${files.toLocaleString()} files`,
  );

  parts.push(formatDurationShort(runDurationMs(run)));

  if (run.bytes_read > 0) parts.push(`${formatBytes(run.bytes_read)} read`);
  if (run.bytes_written > 0) {
    const label = run.kind === "scan" ? "thumbs" : "written";
    parts.push(`${formatBytes(run.bytes_written)} ${label}`);
  }

  const rate = runRate(run);
  if (rate !== null) parts.push(`${rate.toFixed(1)}/s`);

  return parts.join(" · ");
}

export function RunsCard({ runs, drives }: RunsCardProps) {
  const shown = runs.slice(0, RUNS_SHOWN);

  return (
    <div className="flex flex-col">
      <div className="px-6 pt-5 pb-2 font-mono text-[9px] tracking-[2px] text-faint">LAST RUNS</div>

      {shown.length === 0 ? (
        <p className="px-6 pb-6 font-mono text-[11px] text-faint">No jobs have run yet.</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((run) => {
            const driveName = run.drive_id === null ? undefined : drives.find((d) => d.id === run.drive_id)?.name;
            return (
              <li key={run.id} className="flex items-center gap-3 border-b border-border px-6 py-3">
                <span className="text-[13px] font-medium">
                  {kindLabel(run.kind)}
                  {driveName ? ` ${driveName}` : ""}
                </span>
                {run.status !== "done" && (
                  <Badge variant="outline" className={run.status === "failed" ? "text-red-400" : undefined}>
                    {run.status.toUpperCase()}
                  </Badge>
                )}
                <span className="flex-1" />
                <span className="font-mono text-[10.5px] text-muted-foreground">{formatRunLine(run)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
