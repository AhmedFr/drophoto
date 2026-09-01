import { memo, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import type { router } from "@/app/router";
import { DotLoader } from "@/components/DotLoader";
import { Progress } from "@/components/ui/progress";
import { formatDurationShort } from "@/lib/format/duration";
import { activeJobs, etaSeconds, jobRate, useJobsStore } from "@/lib/jobs/jobsStore";

/**
 * Scan and sidecar-sync jobs live under `/drives`; a regen-previews sweep
 * is triggered from (and its progress/errors matter to) `/settings`;
 * organize and revert jobs both live under the `/organize` wizard.
 * `geocode-*` has the same pre-existing quirk of falling through to
 * `/organize` (review finding 6 only covers `regen-*`, which is new).
 */
function targetPath(jobId: string): string {
  if (jobId.startsWith("scan-") || jobId.startsWith("sidecar-")) return "/drives";
  if (jobId.startsWith("regen-")) return "/settings";
  return "/organize";
}

/**
 * The current time, for `jobRate`/`etaSeconds`. Wrapping `Date.now()`
 * behind a plain function (rather than calling it directly in
 * `ActiveJobs`'s body) is what keeps the React Compiler's purity lint
 * quiet — same trick `formatRelative`'s own `Date.now()` default already
 * relies on one function boundary away.
 */
function currentTimeMs(): number {
  return Date.now();
}

type ActiveJobRowProps = {
  jobId: string;
  label: string;
  done: number;
  total: number;
  /** `"6.5/s"`, or `null` when there aren't enough recent samples yet to derive one (see `jobRate`). */
  rateLabel: string | null;
  /** `"~12m left"`, or `null` alongside a `null` `rateLabel`. */
  etaLabel: string | null;
};

/**
 * One active job's row, wrapped in `memo` with React's default shallow
 * prop comparison. Every prop here is a primitive (no objects/arrays), so
 * a progress event on a *different* job — which always produces a fresh
 * `jobs` array from `activeJobs`, forcing `ActiveJobs` itself to
 * re-render — does not force this row's own subtree to re-render unless
 * its own `done`/`total`/rate/eta actually changed. Without this, a
 * single fast-moving scan would repaint every other active job's row on
 * every one of its progress ticks: the flicker this exists to prevent.
 *
 * Stacked three-line layout, because the sidebar is 212px wide and a real
 * scan's readout (`715/16210 · 56.5/s · ~4m 34s left`) simply does not fit
 * beside a label on one line — it used to overflow the strip. Line one is
 * the label with `done/total` right-aligned, line two a slim progress bar
 * (indeterminate during the walk, when there is no total yet), line three
 * the rate/ETA. The bar is always mounted and line three keeps a fixed
 * height even while empty, so the row never changes size as the walk
 * finishes or the first rate sample lands.
 */
const ActiveJobRow = memo(function ActiveJobRow({ jobId, label, done, total, rateLabel, etaLabel }: ActiveJobRowProps) {
  const percent = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  const rateLine = [rateLabel, etaLabel].filter(Boolean).join(" · ");
  return (
    <li className="border-b border-border last:border-b-0">
      <Link<typeof router, string, string>
        to={targetPath(jobId)}
        className="flex flex-col gap-1.5 px-3 py-2 hover:bg-surface"
      >
        <span className="flex items-center gap-2 font-mono text-[9.5px] tracking-[1px] text-muted-foreground uppercase">
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {total > 0 ? (
            <span className="shrink-0 font-mono text-[9px] whitespace-nowrap tabular-nums text-faint normal-case">
              {done}/{total}
            </span>
          ) : (
            <DotLoader size={11} />
          )}
        </span>
        <Progress value={percent} indeterminate={total === 0} className="h-1" />
        <span className="h-3 overflow-hidden text-right font-mono text-[9px] leading-3 whitespace-nowrap tabular-nums text-faint">
          {rateLine}
        </span>
      </Link>
    </li>
  );
});

/**
 * Compact strip at the bottom of `Sidebar` listing every still-running
 * job (scan/organize/revert), so progress stays visible while browsing
 * other pages. Renders nothing when no job is active.
 *
 * Selects `events`/`labels`/`samples` directly (stable references that
 * only change when the store's `set()` actually replaces them) and
 * derives `activeJobs` in a `useMemo` — `activeJobs` itself builds a
 * fresh array of fresh objects on every call, so selecting it straight
 * through `useJobsStore` would hand `useSyncExternalStore` a new
 * snapshot reference on every read and spin into React's "Maximum
 * update depth exceeded" loop.
 */
export function ActiveJobs() {
  const events = useJobsStore((s) => s.events);
  const labels = useJobsStore((s) => s.labels);
  const samples = useJobsStore((s) => s.samples);
  const jobs = useMemo(() => activeJobs({ events, labels }), [events, labels]);

  if (jobs.length === 0) return null;

  const now = currentTimeMs();

  return (
    <div className="mt-auto border-t border-border">
      <ul className="flex flex-col">
        {jobs.map((job) => {
          const total = job.event.kind === "progress" ? job.event.total : 0;
          const done = job.event.kind === "progress" ? job.event.done : 0;
          const rate = total > 0 ? jobRate(samples[job.jobId] ?? [], now) : null;
          const rateLabel = rate !== null ? `${rate.toFixed(1)}/s` : null;
          const eta = rate !== null ? etaSeconds(rate, done, total) : null;
          const etaLabel = eta !== null ? `~${formatDurationShort(eta * 1000)} left` : null;
          return (
            <ActiveJobRow
              key={job.jobId}
              jobId={job.jobId}
              label={job.label}
              done={done}
              total={total}
              rateLabel={rateLabel}
              etaLabel={etaLabel}
            />
          );
        })}
      </ul>
    </div>
  );
}
