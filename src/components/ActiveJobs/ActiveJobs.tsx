import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import type { router } from "@/app/router";
import { DotLoader } from "@/components/DotLoader";
import { activeJobs, useJobsStore } from "@/lib/jobs/jobsStore";

/** Scan jobs live under `/drives`; organize and revert jobs both live under the `/organize` wizard. */
function targetPath(jobId: string): string {
  return jobId.startsWith("scan-") ? "/drives" : "/organize";
}

/**
 * Compact strip at the bottom of `Sidebar` listing every still-running
 * job (scan/organize/revert), so progress stays visible while browsing
 * other pages. Renders nothing when no job is active.
 *
 * Selects `events`/`labels` directly (stable references that only
 * change when the store's `set()` actually replaces them) and derives
 * `activeJobs` in a `useMemo` — `activeJobs` itself builds a fresh array
 * of fresh objects on every call, so selecting it straight through
 * `useJobsStore` would hand `useSyncExternalStore` a new snapshot
 * reference on every read and spin into React's "Maximum update depth
 * exceeded" loop.
 */
export function ActiveJobs() {
  const events = useJobsStore((s) => s.events);
  const labels = useJobsStore((s) => s.labels);
  const jobs = useMemo(() => activeJobs({ events, labels }), [events, labels]);

  if (jobs.length === 0) return null;

  return (
    <div className="mt-auto border-t border-border">
      <ul className="flex flex-col">
        {jobs.map((job) => {
          const total = job.event.kind === "progress" ? job.event.total : 0;
          const done = job.event.kind === "progress" ? job.event.done : 0;
          return (
            <li key={job.jobId} className="border-b border-border last:border-b-0">
              <Link<typeof router, string, string>
                to={targetPath(job.jobId)}
                className="flex items-center gap-2 px-3 py-2 font-mono text-[9.5px] tracking-[1px] text-muted-foreground uppercase hover:bg-surface hover:text-foreground"
              >
                <span className="truncate">{job.label}</span>
                <span className="flex-1" />
                {total > 0 ? (
                  <span className="font-mono text-[9px] text-faint normal-case">
                    {done}/{total}
                  </span>
                ) : (
                  <DotLoader size={11} />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
