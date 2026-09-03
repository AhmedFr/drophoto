import type { Tile } from "@/lib/media/layout";

export type TileProps = {
  tile: Tile;
  onOpen: (index: number) => void;
  selected: boolean;
  /** `shiftKey` distinguishes a plain (cmd/ctrl-click) toggle from a shift-range select. */
  onToggle: (index: number, shiftKey: boolean) => void;
  /** Whether this tile is the current target of GalleryPage's roving keyboard focus. Defaults to false. */
  focused?: boolean;
};
