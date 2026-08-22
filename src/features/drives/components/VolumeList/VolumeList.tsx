import { formatBytes } from "@/lib/format/bytes";
import { Button } from "@/components/ui/button";
import type { VolumeListProps } from "./VolumeList.types";

export function VolumeList({ volumes, onRegister }: VolumeListProps) {
  return (
    <ul className="flex flex-col">
      {volumes.map((v) => (
        <li
          key={v.mount_path}
          className="flex items-center gap-4 border-b border-border px-5 py-3"
        >
          <span className="text-[14px] font-medium">{v.name || v.mount_path}</span>
          <span className="font-mono text-[10px] text-dim">{v.mount_path}</span>
          <span className="flex-1" />
          <span className="font-mono text-[10px] text-muted-foreground">
            {formatBytes(v.free_bytes)} free / {formatBytes(v.total_bytes)}
          </span>
          {onRegister && (
            <Button size="sm" variant="outline" onClick={() => onRegister(v)}>
              Register
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
