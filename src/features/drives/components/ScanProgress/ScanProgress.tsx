import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { DotLoader } from "@/components/DotLoader";
import type { ScanProgressProps } from "./ScanProgress.types";

export function ScanProgress({ event, onCancel }: ScanProgressProps) {
  if (!event) return null;

  // The walk phase (finding files, before any per-file processing has
  // started) has no meaningful done/total yet: `started` is emitted once
  // up front, and the walk itself reports `progress` with `total: 0` as
  // it goes. Neither has a percentage worth showing, so a lightweight
  // dot loader stands in for the bar until real counts arrive.
  const isWalking = event.kind === "started" || (event.kind === "progress" && event.total === 0);

  if (isWalking) {
    const current = event.kind === "progress" ? event.current : null;
    return (
      <div className="flex items-center gap-3 px-5 pb-3">
        <DotLoader label={current ?? "Scanning…"} />
        <Button variant="ghost" size="xs" onClick={onCancel} className="ml-auto">
          Cancel
        </Button>
      </div>
    );
  }

  const done = "done" in event ? event.done : 0;
  const total = "total" in event ? event.total : 0;
  const current = "current" in event ? event.current : null;
  const isTerminal = event.kind === "finished" || event.kind === "cancelled";
  const percent = total > 0 ? (done / total) * 100 : 0;

  return (
    <div className="flex flex-col gap-1.5 px-5 pb-3">
      <Progress value={percent} />
      <div className="flex items-center gap-3">
        <span className="font-mono text-[10px] text-muted-foreground">
          {done} / {total}
        </span>
        {event.kind === "finished" && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {event.ok} ok · {event.failed} failed
          </span>
        )}
        {event.kind === "cancelled" && (
          <span className="font-mono text-[10px] text-muted-foreground">cancelled</span>
        )}
        {!isTerminal && (
          <Button variant="ghost" size="xs" onClick={onCancel} className="ml-auto">
            Cancel
          </Button>
        )}
      </div>
      {current && <span className="truncate font-mono text-[10px] text-faint">{current}</span>}
    </div>
  );
}
