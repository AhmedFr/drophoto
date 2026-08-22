import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format/bytes";
import { ScanProgress } from "../ScanProgress";
import type { DriveCardProps } from "./DriveCard.types";

export function DriveCard({ drive, onScan, onCancelScan, scanEvent }: DriveCardProps) {
  return (
    <li className="flex flex-col border-b border-border">
      <div className="flex items-center gap-4 px-5 py-3">
        <span className="text-[14px] font-medium">{drive.name}</span>
        <Badge variant="outline">{drive.role.toUpperCase()}</Badge>
        <Badge variant="outline">{drive.online ? "ONLINE" : "OFFLINE"}</Badge>
        <span className="flex-1" />
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatBytes(drive.free)} free / {formatBytes(drive.capacity)}
        </span>
        {onScan && (
          <Button variant="outline" size="xs" disabled={!drive.online} onClick={onScan}>
            Scan
          </Button>
        )}
      </div>
      {scanEvent && <ScanProgress event={scanEvent} onCancel={onCancelScan ?? (() => {})} />}
    </li>
  );
}
