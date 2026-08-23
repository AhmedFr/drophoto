import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format/bytes";
import { monthLabel } from "@/lib/media/format";
import { cn } from "@/lib/utils";
import type { SourceRowProps } from "./SourceRow.types";

function dateRange(earliest: string | null, latest: string | null): string {
  const from = monthLabel(earliest);
  const to = monthLabel(latest);
  return from === to ? from : `${from} – ${to}`;
}

export function SourceRow({ summary, selected, onToggle, onScan, scanning }: SourceRowProps) {
  const { drive, count, total, photos, videos, bytes, earliest, latest, legacy } = summary;
  // A drive with no media rows at all has never been scanned. A drive
  // that *does* have rows but nothing left unorganized is simply done —
  // it used to be mislabelled "scan to index" and offered a pointless
  // rescan, because both cases share `count === 0`.
  const neverScanned = total === 0;
  const allOrganized = !neverScanned && count === 0;
  const selectable = !neverScanned && !allOrganized;

  return (
    <li
      className={cn(
        "flex items-center gap-4 border px-4 py-3.5",
        selected ? "border-border-3 bg-surface" : "border-border opacity-60",
      )}
    >
      {neverScanned ? (
        <span className="size-5 flex-none" aria-hidden />
      ) : (
        <Checkbox
          checked={selected}
          disabled={!selectable}
          onCheckedChange={onToggle}
          aria-label={`Select ${drive.name}`}
          className="size-5 flex-none rounded-sm border-border-3 data-[state=checked]:border-primary disabled:opacity-40"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[14px] font-medium">{drive.name}</span>
          <span className="truncate font-mono text-[10.5px] text-dim">{drive.mount_path}</span>
        </div>
        {neverScanned && (
          <span className="font-mono text-[10px] text-muted-foreground">
            No photos indexed yet — scan to index
          </span>
        )}
        {allOrganized && <span className="font-mono text-[10px] text-muted-foreground">All organized</span>}
        {selectable && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {photos} photos · {videos} videos · {dateRange(earliest, latest)} · {formatBytes(bytes)}
          </span>
        )}
        {legacy > 0 && (
          <span className="font-mono text-[10px] text-faint">{legacy} not covered by a source — re-scan</span>
        )}
      </div>
      {neverScanned && (
        <Button variant="outline" size="xs" disabled={scanning} onClick={onScan}>
          {scanning ? "SCANNING…" : "SCAN NOW"}
        </Button>
      )}
    </li>
  );
}
