import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format/bytes";
import { ScanProgress } from "../ScanProgress";
import type { DriveCardProps } from "./DriveCard.types";

export function DriveCard({
  drive,
  sources = [],
  sourcesLoading = false,
  onScan,
  onCancelScan,
  onOpenSources,
  scanEvent,
}: DriveCardProps) {
  const scanInProgress = scanEvent != null && scanEvent.kind !== "finished" && scanEvent.kind !== "cancelled";
  const enabledSources = sources.filter((s) => s.enabled).length;
  // `sources` defaults to `[]` while the caller's query is still in
  // flight, which is indistinguishable from "none configured" — so a
  // card used to flash a red "No sources" on every mount. Treat the
  // loading window as its own state instead of guessing.
  const noEnabledSources = !sourcesLoading && enabledSources === 0;

  return (
    <li className="flex flex-col border-b border-border">
      <div className="flex items-center gap-4 px-5 py-3">
        <span className="text-[14px] font-medium">{drive.name}</span>
        <Badge variant="outline">{drive.online ? "ONLINE" : "OFFLINE"}</Badge>
        <span className="flex-1" />
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatBytes(drive.free)} free / {formatBytes(drive.capacity)}
        </span>
        <span className={`font-mono text-[10px] ${noEnabledSources ? "text-red-400" : "text-faint"}`}>
          {sourcesLoading
            ? "…"
            : noEnabledSources
              ? "No sources"
              : `${enabledSources} source${enabledSources === 1 ? "" : "s"}`}
        </span>
        {onOpenSources && (
          <Button variant="outline" size="xs" onClick={onOpenSources}>
            Sources…
          </Button>
        )}
        {onScan && (
          <Button
            variant="outline"
            size="xs"
            disabled={!drive.online || scanInProgress || sourcesLoading || noEnabledSources}
            title={noEnabledSources ? "Choose sources first" : undefined}
            onClick={onScan}
          >
            Scan
          </Button>
        )}
      </div>
      {scanEvent && <ScanProgress event={scanEvent} onCancel={onCancelScan ?? (() => {})} />}
    </li>
  );
}
