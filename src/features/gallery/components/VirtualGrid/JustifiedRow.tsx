import type { Tile as TileT } from "@/lib/media/layout";
import { Tile } from "../Tile";

type JustifiedRowProps = {
  tiles: TileT[];
  onOpen: (index: number) => void;
  selectedIds: Set<number>;
  onToggle: (index: number, shiftKey: boolean) => void;
  focusIndex: number | null;
};

export function JustifiedRow({ tiles, onOpen, selectedIds, onToggle, focusIndex }: JustifiedRowProps) {
  return (
    <div className="flex gap-2">
      {tiles.map((tile) => (
        <Tile
          key={tile.index}
          tile={tile}
          onOpen={onOpen}
          selected={selectedIds.has(tile.item.row.id)}
          onToggle={onToggle}
          focused={tile.index === focusIndex}
        />
      ))}
    </div>
  );
}
