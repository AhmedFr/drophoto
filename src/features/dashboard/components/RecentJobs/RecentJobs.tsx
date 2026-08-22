import { Link } from "@tanstack/react-router";
import type { router } from "@/app/router";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/format/relative";
import type { RecentJobsProps } from "./RecentJobs.types";

export function RecentJobs({ jobs, now }: RecentJobsProps) {
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
          {jobs.map((job) => (
            <li key={job.id} className="flex items-center gap-4 border-b border-border px-6 py-3">
              <Badge variant="outline" className="gap-1.5">
                {job.status === "running" && (
                  <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
                )}
                {job.status.toUpperCase()}
              </Badge>
              <span className="text-[13px]">{job.drive_name}</span>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {job.moved}/{job.planned} moved · {job.skipped} skipped · {job.failed} failed
              </span>
              <span className="flex-1" />
              <span className="font-mono text-[10px] text-dim">
                {formatRelative(job.finished_at ?? job.started_at, now)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
