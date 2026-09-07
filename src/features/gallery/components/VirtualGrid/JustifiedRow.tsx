import type { MediaItem } from "@/lib/api/media";
import type { Tile as TileT } from "@/lib/media/layout";
import { Tile } from "../Tile";

type JustifiedRowProps = {
  tiles: TileT[];
  /**
   * The hydrated rows, indexed parallel to the timeline index — sparse, so
   * `items[tile.index]` is `undefined` for a tile whose chunk hasn't
   * landed. See `useMediaChunks`.
   */
  items: (MediaItem | undefined)[];
  onOpen: (index: number) => void;
  selectedIds: Set<number>;
  onToggle: (index: number, shiftKey: boolean) => void;
  focusIndex: number | null;
  /** Whether anything is selected — changes what a plain body click means. See `TileProps`. */
  selectionMode: boolean;
  /** The checkmark's discrete toggle (in practice, its keyboard path). */
  onCheckToggle?: (index: number) => void;
  /** Starts a drag-select from a tile's checkmark. */
  onCheckPointerDown?: (index: number, event: { preventDefault: () => void }) => void;
  /** Reports the pointer entering a tile, so a drag in progress extends to it. */
  onTileEnter?: (index: number) => void;
};

export function JustifiedRow({
  tiles,
  items,
  onOpen,
  selectedIds,
  onToggle,
  focusIndex,
  selectionMode,
  onCheckToggle,
  onCheckPointerDown,
  onTileEnter,
}: JustifiedRowProps) {
  return (
    <div className="flex gap-2">
      {tiles.map((tile) => (
        <Tile
          key={tile.index}
          tile={tile}
          item={items[tile.index]}
          onOpen={onOpen}
          selected={selectedIds.has(tile.entry.id)}
          onToggle={onToggle}
          focused={tile.index === focusIndex}
          selectionMode={selectionMode}
          onCheckToggle={onCheckToggle}
          onCheckPointerDown={onCheckPointerDown}
          onPointerEnter={onTileEnter}
        />
      ))}
    </div>
  );
}
