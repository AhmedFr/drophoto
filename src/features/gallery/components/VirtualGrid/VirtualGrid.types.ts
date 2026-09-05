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
};
