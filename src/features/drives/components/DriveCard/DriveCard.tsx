import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/format/bytes";
import type { DriveCardProps } from "./DriveCard.types";

export function DriveCard({ drive }: DriveCardProps) {
  return (
    <li className="flex items-center gap-4 border-b border-border px-5 py-3">
      <span className="text-[14px] font-medium">{drive.name}</span>
      <Badge variant="outline">{drive.role.toUpperCase()}</Badge>
      <Badge variant="outline">{drive.online ? "ONLINE" : "OFFLINE"}</Badge>
      <span className="flex-1" />
      <span className="font-mono text-[10px] text-muted-foreground">
        {formatBytes(drive.free)} free / {formatBytes(drive.capacity)}
      </span>
    </li>
  );
}
