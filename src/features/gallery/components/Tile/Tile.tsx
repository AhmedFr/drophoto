import { Play } from "lucide-react";
import { formatDuration } from "@/lib/media/format";
import { thumbUrl } from "@/lib/media/thumbUrl";
import type { TileProps } from "./Tile.types";

export function Tile({ tile, onOpen }: TileProps) {
  const { item, width, height, index } = tile;
  const { row, thumb_path, drive_name, online } = item;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={row.rel_path}
      className="group relative shrink-0 cursor-pointer overflow-hidden bg-surface-2 outline-none"
      style={{ width, height }}
      onClick={() => onOpen(index)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(index);
      }}
    >
      <img
        loading="lazy"
        alt={row.rel_path}
        src={thumbUrl(thumb_path)}
        className="h-full w-full object-cover"
        onError={(e) => {
          e.currentTarget.style.opacity = "0";
        }}
      />

      {row.kind === "video" && (
        <div
          data-testid="video-badge"
          className="absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-white"
        >
          <Play size={10} strokeWidth={1.6} fill="currentColor" />
          <span className="font-mono text-[9px]">{formatDuration(row.duration_ms)}</span>
        </div>
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
    </div>
  );
}
