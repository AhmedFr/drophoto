import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ScanProgressProps } from "./ScanProgress.types";

export function ScanProgress({ event, onCancel }: ScanProgressProps) {
  if (!event) return null;

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
      {current && (
        <span className="truncate font-mono text-[10px] text-faint">{current}</span>
      )}
    </div>
  );
}
