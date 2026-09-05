import type { MediaItem } from "@/lib/api/media";
import type { Tile } from "@/lib/media/layout";

export type TileProps = {
  /** Geometry and timeline position — known for every tile, hydrated or not. */
  tile: Tile;
  /**
   * The hydrated row for `tile.index`, once its chunk has landed.
   * `undefined` renders a placeholder box of the right size: the layout is
   * already exact (it comes from the timeline index), so nothing reflows
   * when the real item arrives.
   */
  item?: MediaItem;
  onOpen: (index: number) => void;
  selected: boolean;
  /** `shiftKey` distinguishes a plain (cmd/ctrl-click) toggle from a shift-range select. */
  onToggle: (index: number, shiftKey: boolean) => void;
  /** Whether this tile is the current target of GalleryPage's roving keyboard focus. Defaults to false. */
  focused?: boolean;
};
