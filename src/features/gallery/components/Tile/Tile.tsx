import { Check, ImageOff, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/media/format";
import { thumbUrl } from "@/lib/media/thumbUrl";
import type { TileProps } from "./Tile.types";

export function Tile({ tile, item: hydrated, onOpen, selected, onToggle, focused = false }: TileProps) {
  const { entry, width, height, index } = tile;

  // THE invariant, enforced where the paint actually happens: a tile shows
  // a row only if that row IS this tile's photo.
  //
  // The geometry and the rows are cached separately and refetched
  // independently — by a filter change, but equally by any of the app's
  // `invalidateQueries({ queryKey: ["media"] })` calls after a scan, a tag
  // or place edit, a missing-file reconcile, a date recovery. Whenever one
  // side lands first, position N briefly means two different photos on the
  // two sides. Comparing ids here is O(1), needs to know nothing about how
  // the two got out of step, and holds for call sites that don't exist
  // yet — where inferring coherence from arrival timing would not.
  const item = hydrated?.row.id === entry.id ? hydrated : undefined;

  return (
    <div
      role="button"
      tabIndex={0}
      // Placeholders have no path to name themselves with, and no content
      // to describe — `aria-busy` says the box is a stand-in for something
      // still arriving.
      aria-label={item ? item.row.rel_path : "Loading"}
      aria-busy={item ? undefined : true}
      aria-selected={selected}
      data-focused={focused ? "true" : "false"}
      className={cn(
        "group relative shrink-0 cursor-pointer overflow-hidden bg-surface-2 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected && "ring-2 ring-foreground ring-inset",
        focused && "outline-2 outline-offset-[-2px] outline-ring",
      )}
      style={{ width, height }}
      // Selection works on a placeholder — `tile.entry.id` identifies it
      // without any hydrated detail, which is the whole point of selecting
      // across a set the grid hasn't loaded. Opening doesn't: the lightbox
      // needs the row itself, so a plain click on a placeholder is inert
      // rather than opening an empty dialog.
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) onToggle(index, false);
        else if (e.shiftKey) onToggle(index, true);
        else if (item) onOpen(index);
      }}
      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          if (item) onOpen(index);
        } else if (e.key === " ") {
          e.preventDefault();
          onToggle(index, false);
        }
      }}
    >
      {selected && (
        <div
          data-testid="tile-selected-check"
          className="absolute top-1.5 left-1.5 z-10 flex size-4 items-center justify-center bg-foreground text-background"
        >
          <Check size={11} strokeWidth={2.5} />
        </div>
      )}

      {item && <TileContent item={item} />}
    </div>
  );
}

/** Everything that needs the hydrated row: thumbnail, badges, drive name. */
function TileContent({ item }: { item: NonNullable<TileProps["item"]> }) {
  const { row, thumb_path, drive_name, online, has_thumb } = item;

  return (
    <>
      {has_thumb ? (
        <img
          loading="lazy"
          alt={row.rel_path}
          src={thumbUrl(thumb_path)}
          className="h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.opacity = "0";
          }}
        />
      ) : (
        <div
          aria-label="No preview"
          className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-surface-2 text-dim"
        >
          <ImageOff size={20} strokeWidth={1.5} />
          <span className="font-mono text-[9px] tracking-[1px]">{row.ext.toUpperCase()}</span>
        </div>
      )}

      {row.kind === "video" && (
        <div
          data-testid="video-badge"
          className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-white"
        >
          <Play size={10} strokeWidth={1.6} fill="currentColor" />
          <span className="font-mono text-[9px]">{formatDuration(row.duration_ms)}</span>
        </div>
      )}

      {row.missing_at != null && (
        <span
          data-testid="missing-badge"
          className="absolute top-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] tracking-[1px] text-white"
        >
          MISSING
        </span>
      )}

      {!online && (
        <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] tracking-[1px] text-white/60">
          OFFLINE
        </span>
      )}

      <div
        className="pointer-events-none absolute inset-0 flex items-end p-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        style={{ background: "linear-gradient(to top, rgba(8,8,8,0.9), transparent 52%)" }}
      >
        <span className="font-mono text-[9px] text-white">{drive_name}</span>
      </div>
    </>
  );
}
