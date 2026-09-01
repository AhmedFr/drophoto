import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ScanProgressProps } from "./ScanProgress.types";

/**
 * A scan's per-card progress readout. Renders one fixed-height block for
 * every non-terminal event (`started`/`progress`, walk phase or not) —
 * the walk phase used to swap in a completely different `DotLoader`
 * subtree, which is what made the card visibly jump the instant real
 * per-file progress started arriving; now the same progress-bar row,
 * counts row, and current-file row stay mounted throughout, and only the
 * bar's `indeterminate` CSS animation (walk) vs `value` fill (real
 * progress) changes. The counts and current-file rows reserve their own
 * height/width (`tabular-nums`, a fixed-height truncated current-file
 * line) so digit-count and path-length changes never resize the card
 * either — see Task 5b.4's field report: "the UI jumps and twitches so
 * bad it's scary" during a fast scan.
 *
 * A terminal event (`finished`/`cancelled`) swaps the bar/current-file
 * rows for a one-line summary instead — kept in the same outer block
 * (still `DrivesPage`'s way of showing a scan's last-known outcome after
 * it ends or the page remounts). A `finished` event with `failed > 0`
 * turns "N failed" into a button opening `ScanErrorsDialog`, when
 * `onOpenErrors` is given — Task 5b.4's other field report: "a scan fails
 * with a huge amount of errors but no reason, no place to check the
 * errors".
 */
export function ScanProgress({ event, onCancel, onOpenErrors }: ScanProgressProps) {
  if (!event) return null;

  const isTerminal = event.kind === "finished" || event.kind === "cancelled";
  // The walk phase (finding files, before any per-file processing has
  // started) has no meaningful done/total yet: `started` is emitted once
  // up front, and the walk itself reports `progress` with `total: 0` as
  // it goes.
  const isWalking = event.kind === "started" || (event.kind === "progress" && event.total === 0);
  const done = event.kind === "progress" ? event.done : 0;
  const total = event.kind === "progress" ? event.total : 0;
  const current = event.kind === "progress" ? event.current : null;
  const percent = total > 0 ? (done / total) * 100 : 0;
  // Reserved width for the counts row, sized off `total`'s digit count so
  // `done` growing from single to multiple digits never shifts the row —
  // a placeholder digit count before `total` is known (during the walk).
  const totalDigits = total > 0 ? String(total).length : 4;

  return (
    <div className="flex flex-col gap-1.5 px-5 pb-3">
      {!isTerminal && <Progress value={percent} indeterminate={isWalking} />}
      <div className="flex items-center gap-3">
        {isTerminal ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            {event.kind === "finished" ? (
              event.ok === 0 && event.failed === 0 && event.skipped > 0 ? (
                `Up to date · ${event.skipped} skipped`
              ) : (
                <>
                  {event.ok} ok ·{" "}
                  {event.failed > 0 && onOpenErrors ? (
                    <button
                      type="button"
                      onClick={onOpenErrors}
                      className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                    >
                      {event.failed} failed
                    </button>
                  ) : (
                    `${event.failed} failed`
                  )}
                  {event.skipped > 0 ? ` · ${event.skipped} skipped` : ""}
                </>
              )
            ) : (
              "cancelled"
            )}
          </span>
        ) : (
          <>
            <span
              className="font-mono text-[10px] text-muted-foreground tabular-nums"
              style={{ minWidth: `${totalDigits * 2 + 3}ch` }}
            >
              {done} / {total}
            </span>
            <Button variant="ghost" size="xs" onClick={onCancel} className="ml-auto">
              Cancel
            </Button>
          </>
        )}
      </div>
      {!isTerminal && (
        <span className="block h-[14px] truncate font-mono text-[10px] text-faint">{current}</span>
      )}
    </div>
  );
}
