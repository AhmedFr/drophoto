import { Link } from "@tanstack/react-router";
import type { router } from "@/app/router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RevertConfirmDialog } from "@/components/RevertConfirmDialog";
import { formatRelative } from "@/lib/format/relative";
import { useRevertRow } from "../../hooks/useRevertRow";
import type { OrganizeJobRow } from "@/lib/api/organize";
import type { RecentJobsProps } from "./RecentJobs.types";

/** Whether `job` can offer a REVERT action: a finished (non-running) organize job, not itself a revert, that moved something, and not already reverted. */
function isRevertable(job: OrganizeJobRow): boolean {
  return job.kind === "organize" && job.status !== "running" && job.reverted_by_job_id == null && job.moved > 0;
}

export function RecentJobs({ jobs, now }: RecentJobsProps) {
  const revert = useRevertRow();
  const confirmJob = jobs.find((j) => j.id === revert.confirmJobId) ?? null;

  return (
    <div className="flex flex-col">
      <div className="px-6 pt-5 pb-2 font-mono text-[9px] tracking-[2px] text-faint">
        RECENT ORGANIZE JOBS
      </div>

      {jobs.length === 0 ? (
        <p className="px-6 pb-6 font-mono text-[11px] text-faint">
          No organize jobs yet.{" "}
          {/*
            The feature registry (`src/app/registry.ts`) types each module's
            route `path` as a plain `string`, so the router's generated
            route tree loses literal path types and can't type-check `to`
            against the app's real routes. Widening the generics here keeps
            this a real `Link` — with active-state and prefetch support —
            while avoiding an unchecked `to` string. (Same pattern as
            `GalleryPage` and `DoneOverlay`.)
          */}
          <Link<typeof router, string, string> to="/organize" className="underline">
            Organize now
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col">
          {jobs.map((job) => {
            const isReverting = revert.revertingJobId === job.id;
            const rowError = revert.revertError?.jobId === job.id ? revert.revertError.message : null;
            return (
              <li key={job.id} className="flex items-center gap-4 border-b border-border px-6 py-3">
                <Badge variant="outline" className="gap-1.5">
                  {job.status === "running" && (
                    <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
                  )}
                  {job.status.toUpperCase()}
                </Badge>
                {job.kind === "revert" && (
                  <>
                    <Badge variant="outline">REVERT</Badge>
                    <span className="font-mono text-[10px] text-faint">of job #{job.reverts_job_id}</span>
                  </>
                )}
                <span className="text-[13px]">{job.drive_name}</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">
                  {job.moved}/{job.planned} moved · {job.skipped} skipped · {job.failed} failed
                </span>
                <span className="flex-1" />
                {rowError && <span className="font-mono text-[10px] text-red-400">{rowError}</span>}
                {isReverting && (
                  <span className="font-mono text-[10px] text-dim">
                    REVERTING… {revert.revertProgress?.done ?? 0}/{revert.revertProgress?.total ?? 0}
                  </span>
                )}
                {isRevertable(job) && !isReverting && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="font-mono text-[9.5px] tracking-[1px]"
                    onClick={() => revert.requestRevert(job.id)}
                  >
                    REVERT
                  </Button>
                )}
                <span className="font-mono text-[10px] text-dim">
                  {formatRelative(job.finished_at ?? job.started_at, now)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <RevertConfirmDialog
        open={confirmJob != null}
        moved={confirmJob?.moved ?? 0}
        onCancel={revert.cancelRevert}
        onConfirm={revert.confirmRevert}
      />
    </div>
  );
}
