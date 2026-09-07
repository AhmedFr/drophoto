import type { MediaItem } from "@/lib/api/media";
import type { LayoutEntry } from "@/lib/media/layout";

export type VirtualGridProps = {
  /**
   * The whole filtered set, as the geometry needed to lay it out — the
   * gallery's timeline index. The grid's height, month grouping and tile
   * positions are exact from the first render, whether or not the rows
   * themselves have been hydrated yet.
   */
  entries: LayoutEntry[];
  /**
   * The hydrated rows, indexed parallel to `entries` and sparse: a tile
   * whose chunk hasn't landed gets `undefined` and renders as a
   * placeholder. See `useMediaChunks`.
   */
  items: (MediaItem | undefined)[];
  targetRowHeight: number;
  onOpen: (index: number) => void;
  selectedIds: Set<number>;
  /** `shiftKey` distinguishes a plain (cmd/ctrl-click) toggle from a shift-range select. */
  onToggle: (index: number, shiftKey: boolean) => void;
  /** Index (in `entries`) of the tile GalleryPage's grid-level keyboard handling currently targets, or `null` when nothing has roving focus yet. */
  focusIndex?: number | null;
  /**
   * Reports the current row grouping — each row as the `entries`-array
   * indices of its tiles, in column order, omitting month headers —
   * whenever the justified layout is recomputed. GalleryPage keeps the
   * latest value in a ref and uses it to move keyboard focus a row at a
   * time, since the layout doesn't have a fixed items-per-row count.
   */
  onRowsChange?: (rows: number[][]) => void;
  /**
   * Reports the `entries` index range the grid is currently rendering,
   * already widened by the virtualizer's overscan. GalleryPage feeds it to
   * `useMediaChunks` to decide which chunks to hydrate.
   */
  onRangeChange?: (range: { start: number; end: number }) => void;
  /** Fired by a `MonthHeader`'s select action: `ids` are that month's media ids, `additive` is true on cmd/ctrl-click (add to the selection) vs. a plain click (replace it). */
  onSelectMonth?: (ids: number[], additive: boolean) => void;
  /**
   * Whether anything is selected. Passed straight through to every `Tile`,
   * where it decides whether a plain body click opens the lightbox or
   * toggles. Defaults to false.
   */
  selectionMode?: boolean;
  /** A tile checkmark's discrete toggle — in practice its keyboard path, since a pointer press is a drag gesture. */
  onCheckToggle?: (index: number) => void;
  /** Starts a drag-select from a tile's checkmark. */
  onCheckPointerDown?: (index: number, event: { preventDefault: () => void }) => void;
  /** Reports the pointer entering a tile, so a drag in progress extends to it. */
  onTileEnter?: (index: number) => void;
  /**
   * Whether a drag-select is currently live. While it is, the grid scrolls
   * itself when the pointer nears its top or bottom edge, so a selection
   * can run past what is on screen. See `useEdgeAutoScroll`.
   */
  isDragging?: boolean;
};
