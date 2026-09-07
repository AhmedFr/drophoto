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
  /**
   * Whether the gallery is in selection mode (derived by GalleryPage from
   * "anything is selected"). It changes what a plain click on the tile
   * *body* means: opening the lightbox when off, toggling when on — the
   * Google Photos rule. Defaults to false.
   */
  selectionMode?: boolean;
  /**
   * The checkmark button's discrete toggle. Only reached when no pointer
   * press drove the activation — a pointer press is `onCheckPointerDown`'s
   * gesture, which already toggles its origin — so in practice this is the
   * keyboard path (Enter/Space on the focused checkmark). Defaults to a
   * plain `onToggle(index, false)`.
   */
  onCheckToggle?: (index: number) => void;
  /**
   * Starts the drag-select gesture from this tile's checkmark. When
   * omitted the checkmark is a plain toggle button and nothing is dragged.
   */
  onCheckPointerDown?: (index: number, event: { preventDefault: () => void }) => void;
  /** Reports the pointer entering this tile, so a drag in progress can extend to it. */
  onPointerEnter?: (index: number) => void;
  /**
   * Whether the click currently being handled was produced by a checkmark
   * press the drag gesture already acted on — read once, then cleared.
   *
   * Consulted by the tile *body* as well as the checkmark: when a press
   * and its release have different targets the browser dispatches the
   * click on their nearest common ancestor, so a press that drifts a few
   * pixels off the checkmark lands its click on the tile.
   */
  consumeGestureClick?: () => boolean;
};
