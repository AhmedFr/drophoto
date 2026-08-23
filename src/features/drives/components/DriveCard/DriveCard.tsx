import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format/bytes";
import { ScanProgress } from "../ScanProgress";
import type { DriveCardProps } from "./DriveCard.types";

export function DriveCard({
  drive,
  sources = [],
  onScan,
  onCancelScan,
  onOpenSources,
  scanEvent,
}: DriveCardProps) {
  const scanInProgress = scanEvent != null && scanEvent.kind !== "finished" && scanEvent.kind !== "cancelled";
  const totalSources = sources.length;
  const enabledSources = sources.filter((s) => s.enabled).length;
  const noEnabledSources = enabledSources === 0;

  return (
    <li className="flex flex-col border-b border-border">
      <div className="flex items-center gap-4 px-5 py-3">
        <span className="text-[14px] font-medium">{drive.name}</span>
        <Badge variant="outline">{drive.online ? "ONLINE" : "OFFLINE"}</Badge>
        <span className="flex-1" />
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatBytes(drive.free)} free / {formatBytes(drive.capacity)}
        </span>
        <span className={`font-mono text-[10px] ${totalSources === 0 ? "text-red-400" : "text-faint"}`}>
          {totalSources === 0 ? "No sources" : `${totalSources} source${totalSources === 1 ? "" : "s"}`}
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
            disabled={!drive.online || scanInProgress || noEnabledSources}
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
