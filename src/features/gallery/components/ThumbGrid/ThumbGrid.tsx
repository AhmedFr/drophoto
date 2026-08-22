import { Play } from "lucide-react";
import { thumbUrl } from "@/lib/media/thumbUrl";
import type { ThumbGridProps } from "./ThumbGrid.types";

export function ThumbGrid({ items }: ThumbGridProps) {
  return (
    <div className="[column-width:240px] gap-2 p-5">
      {items.map(({ row, thumb_path, drive_name, online }) => {
        const { width, height } = row;
        return (
          <div
            key={row.id}
            className="relative mb-2 break-inside-avoid overflow-hidden bg-surface-2"
            style={{ aspectRatio: width && height ? `${width} / ${height}` : "4 / 3" }}
          >
            <img
              loading="lazy"
              alt={row.rel_path}
              src={thumbUrl(thumb_path)}
              className="absolute inset-0 h-full w-full object-cover"
              onError={(e) => {
                e.currentTarget.style.opacity = "0";
              }}
            />
            {row.kind === "video" && (
              <div
                data-testid="video-badge"
                className="absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
              >
                <Play size={11} strokeWidth={1.6} fill="currentColor" />
              </div>
            )}
            <div className="absolute right-1.5 bottom-1.5 flex items-center gap-1">
              {!online && (
                <span className="rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] tracking-[1px] text-white/60">
                  OFFLINE
                </span>
              )}
              <span className="rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px] tracking-[1px] text-white">
                {drive_name}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
