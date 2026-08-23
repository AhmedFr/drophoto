import { Link } from "@tanstack/react-router";
import type { router } from "@/app/router";
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

export function SourceRow({ summary, selected, onToggle, onScan, scanning, scanError }: SourceRowProps) {
  const { drive, count, total, photos, videos, bytes, earliest, latest, legacy, has_sources } = summary;
  // A drive with no media rows at all has never been scanned. A drive
  // that *does* have rows but nothing left unorganized is simply done —
  // it used to be mislabelled "scan to index" and offered a pointless
  // rescan, because both cases share `count === 0`. A third case shares
  // that same `count === 0`, though: every remaining row could be
  // *legacy* (scanned before sources existed) rather than truly
  // organized — re-scanning is what resolves it, so it needs its own
  // state rather than being folded into "All organized".
  const neverScanned = total === 0;
  const legacyOnly = !neverScanned && count === 0 && legacy > 0;
  const allOrganized = !neverScanned && count === 0 && legacy === 0;
  const selectable = !neverScanned && !allOrganized && !legacyOnly;
  const needsScan = neverScanned || legacyOnly;
  // With no enabled source, a scan walks nothing: it would "succeed"
  // having found zero photos and leave the row saying exactly what it
  // said before. Send the user to Drives to pick folders instead.
  const showSetUpSources = needsScan && !has_sources;
  const showScanNow = needsScan && has_sources;

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
      {(showScanNow || showSetUpSources) && (
        <div className="flex flex-none flex-col items-end gap-1">
          {showSetUpSources ? (
            <Button variant="outline" size="xs" asChild>
              <Link<typeof router, string, string> to="/drives">SET UP SOURCES…</Link>
            </Button>
          ) : (
            <Button variant="outline" size="xs" disabled={scanning} onClick={onScan}>
              {scanning ? "SCANNING…" : "SCAN NOW"}
            </Button>
          )}
          {scanError && (
            <span role="alert" className="max-w-52 text-right font-mono text-[10px] text-red-400">
              {scanError}
            </span>
          )}
        </div>
      )}
    </li>
  );
}
