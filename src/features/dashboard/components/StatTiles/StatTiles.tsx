import { cn } from "@/lib/utils";
import type { StatTilesProps } from "./StatTiles.types";

export function StatTiles({ photos, videos, unorganized, drivesOnline, drivesTotal }: StatTilesProps) {
  const tiles = [
    { label: "PHOTOS", value: photos },
    { label: "VIDEOS", value: videos },
    { label: "UNORGANIZED", value: unorganized },
    { label: "DRIVES ONLINE", value: `${drivesOnline}/${drivesTotal}` },
  ];

  return (
    <div className="grid grid-cols-4 border-b border-border">
      {tiles.map((tile, i) => (
        <div
          key={tile.label}
          className={cn(
            "flex flex-col gap-1.5 px-6 py-5",
            i < tiles.length - 1 && "border-r border-border",
          )}
        >
          <span className="font-mono text-[32px] leading-none">{tile.value}</span>
          <span className="font-mono text-[9px] tracking-[1.5px] text-faint">{tile.label}</span>
        </div>
      ))}
    </div>
  );
}
