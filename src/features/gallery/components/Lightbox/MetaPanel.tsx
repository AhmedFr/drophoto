import { useEffect, useState } from "react";
import { XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlacePanel } from "@/features/places/components/PlacePanel";
import { usePlaces } from "@/features/places/hooks/usePlaces";
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
  /** See `LightboxProps.onPlacePanelOpenChange` — forwarded through unchanged. */
  onPlacePanelOpenChange?: (open: boolean) => void;
};

export function MetaPanel({ item, onTagPanelOpenChange, onPlacePanelOpenChange }: MetaPanelProps) {
  const { row } = item;
  const coords = formatCoords(row.lat, row.lon);
  const canReveal = item.online && item.original_path != null;
  const [revealError, setRevealError] = useState<string | null>(null);
  const [tagPanelOpen, setTagPanelOpenState] = useState(false);
  const [placePanelOpen, setPlacePanelOpenState] = useState(false);

  // Wraps the local open flag so `GalleryPage` also learns about this
  // nested `TagPanel`'s open state (its document-level Escape handler
  // needs to yield to Radix while this dialog is open — see
  // `Lightbox.types.ts`).
  function setTagPanelOpen(next: boolean) {
    setTagPanelOpenState(next);
    onTagPanelOpenChange?.(next);
  }

  // Same wrapping, for the PLACE row's own single-id `PlacePanel`.
  function setPlacePanelOpen(next: boolean) {
    setPlacePanelOpenState(next);
    onPlacePanelOpenChange?.(next);
  }

  // This panel is keyed on `item.row.id` by the lightbox, so navigating
  // to another photo unmounts it — without this cleanup, an open
  // TagPanel's/PlacePanel's `true` would outlive the panel and permanently
  // disable GalleryPage's Escape-clears-selection branch for the session.
  const notifyClosed = onTagPanelOpenChange;
  useEffect(() => {
    return () => {
      notifyClosed?.(false);
    };
  }, [notifyClosed]);

  const notifyPlaceClosed = onPlacePanelOpenChange;
  useEffect(() => {
    return () => {
      notifyPlaceClosed?.(false);
    };
  }, [notifyPlaceClosed]);

  // `MediaRow` only carries `place_id`; a place with any media attached
  // always shows up in `listPlaceCounts` (that's what makes it a place
  // with a count in the first place), so this client-side lookup avoids a
  // separate `getPlace` round trip for what's otherwise already cached
  // data from `usePlaces`.
  const { placeCounts } = usePlaces();
  const place = placeCounts.find((pc) => pc.place.id === row.place_id)?.place ?? null;
  // The geocoder's nearest known city — no neighborhood data exists in the
  // GeoNames cities dataset it's built on, so this is as precise as the
  // human-readable name ever gets.
  const placeLabel = place
    ? [place.name, place.admin, place.country].filter(Boolean).join(", ")
    : null;

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

        <MetaSection title="PLACE">
          <div className="flex items-start justify-between py-1.5 font-mono text-[11px]">
            {placeLabel ? (
              // Geocoded: the human name leads, raw coords trail as a
              // faint secondary line for anyone who wants the precise fix.
              <div>
                <p className="text-dim">{placeLabel}</p>
                <p className="mt-0.5 text-faint text-[10px]">{coords}</p>
              </div>
            ) : coords ? (
              // Has coords but hasn't been geocoded yet (or was cleared) —
              // lead with the coords and point at Places to geocode it.
              <div>
                <p className="text-dim">{coords}</p>
                <p className="mt-0.5 text-faint text-[10px]">
                  not placed yet — GEOCODE NOW on Places
                </p>
              </div>
            ) : (
              <p className="text-dim">No location data</p>
            )}
            <button
              type="button"
              onClick={() => setPlacePanelOpen(true)}
              className="text-dim hover:text-foreground"
            >
              Change
            </button>
          </div>
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
      <PlacePanel mediaIds={[row.id]} open={placePanelOpen} onClose={() => setPlacePanelOpen(false)} />
    </div>
  );
}
