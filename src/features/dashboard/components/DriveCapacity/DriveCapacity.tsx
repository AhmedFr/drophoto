import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/format/bytes";
import type { DriveCapacityProps } from "./DriveCapacity.types";

export function DriveCapacity({ drives }: DriveCapacityProps) {
  return (
    <div className="flex flex-col">
      <div className="px-6 pt-5 pb-2 font-mono text-[9px] tracking-[2px] text-faint">DRIVES</div>

      {drives.length === 0 ? (
        <p className="px-6 pb-6 font-mono text-[11px] text-faint">No drives registered.</p>
      ) : (
        <ul className="flex flex-col">
          {drives.map((drive) => {
            const used = drive.capacity - drive.free;
            const pct = drive.capacity > 0 ? (used / drive.capacity) * 100 : 0;
            return (
              <li key={drive.id} className="flex flex-col gap-2 border-b border-border px-6 py-3.5">
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-medium">{drive.name}</span>
                  <Badge variant="outline">{drive.online ? "ONLINE" : "OFFLINE"}</Badge>
                </div>
                <Progress value={pct} aria-label={`${drive.name} capacity`} />
                <span className="font-mono text-[10px] text-muted-foreground">
                  {formatBytes(used)} of {formatBytes(drive.capacity)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
