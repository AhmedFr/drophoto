import type { MediaItem } from "@/lib/api/media";

export type VirtualGridProps = {
  items: MediaItem[];
  targetRowHeight: number;
  onOpen: (index: number) => void;
  onNearEnd?: () => void;
  selectedIds: Set<number>;
  /** `shiftKey` distinguishes a plain (cmd/ctrl-click) toggle from a shift-range select. */
  onToggle: (index: number, shiftKey: boolean) => void;
  /** Index (in `items`) of the tile GalleryPage's grid-level keyboard handling currently targets, or `null` when nothing has roving focus yet. */
  focusIndex?: number | null;
  /**
   * Reports the current row grouping — each row as the `items`-array
   * indices of its tiles, in column order, omitting month headers —
   * whenever the justified layout is recomputed. GalleryPage keeps the
   * latest value in a ref and uses it to move keyboard focus a row at a
   * time, since the layout doesn't have a fixed items-per-row count.
   */
  onRowsChange?: (rows: number[][]) => void;
  /** Fired by a `MonthHeader`'s select action: `ids` are that month's media ids, `additive` is true on cmd/ctrl-click (add to the selection) vs. a plain click (replace it). */
  onSelectMonth?: (ids: number[], additive: boolean) => void;
};
