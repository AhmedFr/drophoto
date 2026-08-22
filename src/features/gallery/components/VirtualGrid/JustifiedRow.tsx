import type { Tile as TileT } from "@/lib/media/layout";
import { Tile } from "../Tile";

type JustifiedRowProps = { tiles: TileT[]; onOpen: (index: number) => void };

export function JustifiedRow({ tiles, onOpen }: JustifiedRowProps) {
  return (
    <div className="flex gap-2">
      {tiles.map((tile) => (
        <Tile key={tile.index} tile={tile} onOpen={onOpen} />
      ))}
    </div>
  );
}
