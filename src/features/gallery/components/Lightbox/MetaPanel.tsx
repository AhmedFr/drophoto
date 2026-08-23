import { useState } from "react";
import { XIcon } from "lucide-react";
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
import { TagPanel } from "../TagPanel";
import { useTags } from "../../hooks/useTags";
import { MetaRow } from "./MetaRow";
import { MetaSection } from "./MetaSection";

export type MetaPanelProps = {
  item: MediaItem;
  /** See `LightboxProps.onTagPanelOpenChange` — forwarded through unchanged. */
  onTagPanelOpenChange?: (open: boolean) => void;
};

export function MetaPanel({ item, onTagPanelOpenChange }: MetaPanelProps) {
  const { row } = item;
  const coords = formatCoords(row.lat, row.lon);
  const canReveal = item.online && item.original_path != null;
  const [revealError, setRevealError] = useState<string | null>(null);
  const [tagPanelOpen, setTagPanelOpenState] = useState(false);

  // Wraps the local open flag so `GalleryPage` also learns about this
  // nested `TagPanel`'s open state (its document-level Escape handler
  // needs to yield to Radix while this dialog is open — see
  // `Lightbox.types.ts`).
  function setTagPanelOpen(next: boolean) {
    setTagPanelOpenState(next);
    onTagPanelOpenChange?.(next);
  }

  // A single-id `states` map can only ever read "all" (has the tag) or be
  // absent (doesn't) — "some" needs more than one id — so this doubles as
  // the item's own tag list without a separate `tagsForMedia` call.
  const { allTags, states, apply, isApplying, error } = useTags([row.id]);
  const tags = allTags.filter((tag) => states[tag.id] === "all");

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
          <div className="flex flex-wrap items-center gap-1.5 py-1.5">
            {tags.length === 0 && <p className="font-mono text-[11px] text-dim">No tags</p>}
            {tags.map((tag) => (
              <Badge key={tag.id} variant="outline" className="gap-1 font-mono text-[10px]">
                {tag.name}
                <button
                  type="button"
                  aria-label={`Remove ${tag.name}`}
                  onClick={() => apply({ add: [], remove: [tag.id] })}
                  disabled={isApplying}
                  className="text-dim hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                >
                  <XIcon size={10} />
                </button>
              </Badge>
            ))}
            <button
              type="button"
              aria-label="Add tag"
              onClick={() => setTagPanelOpen(true)}
              disabled={isApplying}
              className="flex size-4 items-center justify-center rounded-full border border-border text-dim hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              +
            </button>
          </div>
          {error && <p className="font-mono text-[10px] text-red-400">{error}</p>}
        </MetaSection>
      </div>

      <Button variant="outline" className="mt-6 w-full" disabled={!canReveal} onClick={handleReveal}>
        Reveal in Finder
      </Button>
      {revealError && <p className="mt-2 font-mono text-[10px] text-red-400">{revealError}</p>}

      <TagPanel mediaIds={[row.id]} open={tagPanelOpen} onClose={() => setTagPanelOpen(false)} />
    </div>
  );
}
