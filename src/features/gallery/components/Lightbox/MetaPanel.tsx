import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { revealInFinder } from "@/lib/api/opener";
import { formatBytes } from "@/lib/format/bytes";
import {
  basename,
  formatCoords,
  formatDims,
  formatExposure,
  formatIsoFocal,
  formatTakenAt,
} from "@/lib/media/format";
import type { MediaItem } from "@/lib/api/media";
import { MetaRow } from "./MetaRow";
import { MetaSection } from "./MetaSection";

export type MetaPanelProps = { item: MediaItem };

export function MetaPanel({ item }: MetaPanelProps) {
  const { row } = item;
  const coords = formatCoords(row.lat, row.lon);
  const canReveal = item.online && item.original_path != null;
  const [revealError, setRevealError] = useState<string | null>(null);

  const handleReveal = async () => {
    setRevealError(null);
    try {
      await revealInFinder(item.original_path!);
    } catch (err) {
      setRevealError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1">
        <h2 className="text-[20px] font-semibold text-foreground">{basename(row.rel_path)}</h2>
        <p className="mt-1 font-mono text-[10px] text-dim">
          {formatDims(row.width, row.height)} · {formatBytes(row.size)} · {row.ext.toUpperCase()}
        </p>

        <MetaSection title="CAMERA">
          <MetaRow label="Body" value={row.camera ?? "—"} />
          <MetaRow label="Lens" value={row.lens ?? "—"} />
          <MetaRow label="Exposure" value={formatExposure(row.aperture, row.shutter)} />
          <MetaRow label="ISO · Focal" value={formatIsoFocal(row.iso, row.focal_mm)} />
        </MetaSection>

        <MetaSection title="CAPTURE">
          <MetaRow label="Taken" value={formatTakenAt(row.taken_at)} />
          <div className="flex items-center justify-between py-1.5 font-mono text-[11px]">
            <span className="text-dim">Drive</span>
            <span className="flex items-center gap-1.5 text-foreground">
              {item.drive_name}
              {!item.online && <Badge variant="outline">OFFLINE</Badge>}
            </span>
          </div>
        </MetaSection>

        <MetaSection title="LOCATION">
          <p className="py-1.5 font-mono text-[11px] text-dim">{coords || "No location data"}</p>
        </MetaSection>

        <MetaSection title="PEOPLE">
          <p className="py-1.5 font-mono text-[11px] text-dim">No people tagged</p>
        </MetaSection>

        <MetaSection title="TAGS">
          <p className="py-1.5 font-mono text-[11px] text-dim">No tags</p>
        </MetaSection>
      </div>

      <Button variant="outline" className="mt-6 w-full" disabled={!canReveal} onClick={handleReveal}>
        Reveal in Finder
      </Button>
      {revealError && <p className="mt-2 font-mono text-[10px] text-red-400">{revealError}</p>}
    </div>
  );
}
