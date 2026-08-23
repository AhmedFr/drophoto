import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "@/lib/format/bytes";
import type { DetectedFolderRowProps } from "./DetectedFolderRow.types";

export function DetectedFolderRow({ row, onToggle }: DetectedFolderRowProps) {
  const label = row.rel_path === "" ? "Whole drive" : row.rel_path;

  return (
    <label className="flex items-center gap-3 rounded-md px-1 py-1.5 hover:bg-accent/50">
      <Checkbox checked={row.checked} onCheckedChange={onToggle} aria-label={label} />
      <span className="flex-1 truncate text-[13px]">{label}</span>
      {row.media_count != null && (
        <span className="whitespace-nowrap font-mono text-[10px] text-dim">
          {row.media_count} photos · {formatBytes(row.bytes ?? 0)}
        </span>
      )}
      {row.suggested && <Badge variant="outline">SUGGESTED</Badge>}
    </label>
  );
}
