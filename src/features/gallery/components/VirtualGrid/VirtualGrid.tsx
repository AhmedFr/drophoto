import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatFullDate } from "@/lib/media/format";
import { buildLayout, GAP, type LayoutItem } from "@/lib/media/layout";
import { buildTicks, tileIndexAtOffset } from "@/lib/media/timelineTicks";
import { DateScrubber } from "../DateScrubber";
import { MAX_TICKS } from "../DateScrubber/DateScrubber.constants";
import { JustifiedRow } from "./JustifiedRow";
import { MonthHeader } from "./MonthHeader";
import { useContainerWidth } from "./useContainerWidth";
import { useEdgeAutoScroll } from "./useEdgeAutoScroll";
import type { VirtualGridProps } from "./VirtualGrid.types";

/**
 * The scroll container's own `p-4`, in pixels. `scrollTop` counts it and
 * the layout's row offsets don't, so mapping one to the other has to
 * account for it.
 */
const CONTENT_PADDING = 16;

/** A `layout` offset in the scroll container's own coordinates. */
const withPadding = (offset: number) => offset + CONTENT_PADDING;

function VirtualGridImpl({
  entries,
  items,
  targetRowHeight,
  onOpen,
  selectedIds,
  onToggle,
  focusIndex = null,
  onRowsChange,
  onRangeChange,
  onSelectMonth,
  selectionMode = false,
  onCheckToggle,
  onCheckPointerDown,
  onTileEnter,
  consumeGestureClick,
  isDragging = false,
}: VirtualGridProps) {
  // `useContainerWidth` measures `contentRect.width`, which already excludes
  // the scroll element's `p-4` padding — no further subtraction needed here.
  const { ref, width } = useContainerWidth<HTMLDivElement>();

  // A drag-select that reaches the edge keeps going: the container scrolls
  // under the pointer, so a range can span more than one screenful without
  // the user letting go.
  // `onTileEnter` is handed over too: scrolling alone would move the grid
  // without extending the selection, since a pointer held past the edge is
  // over no tile and fires no `pointerenter`.
  useEdgeAutoScroll(ref, isDragging, onTileEnter);

  // Built from the index, not the hydrated rows: the layout is complete and
  // final from the first render, so a chunk landing never reflows the grid
  // or moves the scrollbar under the user's thumb.
  const layout = useMemo(
    () => buildLayout(entries, width, targetRowHeight),
    [entries, width, targetRowHeight],
  );

  const virtualizer = useVirtualizer({
    count: layout.length,
    getScrollElement: () => ref.current,
    estimateSize: (i) => layout[i].height + GAP,
    overscan: 6,
  });

  // TanStack Virtual's measurement memo isn't keyed on `estimateSize`, so a
  // container resize that doesn't change `layout.length` (e.g. the same
  // number of rows re-packed at a new width) leaves stale `start`/total-size
  // values behind. Re-measuring whenever `layout` is a new reference (i.e.
  // whenever width, entries, or row height change) keeps them in sync.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, layout]);

  // Row grouping (each row as its tiles' `entries`-array indices, in column
  // order, omitting headers) for GalleryPage's keyboard Up/Down handling —
  // see `onRowsChange`'s docs. Recomputed only when `layout` itself changes.
  const rows = useMemo(
    () =>
      layout
        .filter((l): l is Extract<LayoutItem, { kind: "row" }> => l.kind === "row")
        .map((row) => row.tiles.map((t) => t.index)),
    [layout],
  );

  useEffect(() => {
    onRowsChange?.(rows);
  }, [rows, onRowsChange]);

  const virtualItems = virtualizer.getVirtualItems();
  const firstVirtual = virtualItems.length > 0 ? virtualItems[0].index : 0;
  const lastVirtual = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1;

  // The tile-index span the virtualizer is currently rendering. Derived
  // from the first/last virtual *layout* indices rather than the
  // `getVirtualItems()` array itself, which is a fresh identity every
  // render; the virtualizer's own `overscan` is already baked into that
  // span, so no extra widening is needed here.
  const range = useMemo(() => {
    let start = Number.POSITIVE_INFINITY;
    let end = -1;
    for (let i = firstVirtual; i <= lastVirtual; i++) {
      const row = layout[i];
      if (row?.kind !== "row") continue;
      for (const tile of row.tiles) {
        if (tile.index < start) start = tile.index;
        if (tile.index > end) end = tile.index;
      }
    }
    // Nothing laid out yet (no width, no entries, or headers only) — chunk
    // 0 is still the right thing to hydrate, so the first rows are already
    // in flight by the time the index lands.
    return end < 0 ? { start: 0, end: 0 } : { start, end };
  }, [layout, firstVirtual, lastVirtual]);

  useEffect(() => {
    onRangeChange?.(range);
  }, [range, onRangeChange]);

  // Where every layout item starts, in the scrolled content's own
  // coordinates. Computed here rather than asked of the virtualizer, which
  // only reports the handful of items it is currently rendering — the
  // scrubber needs the whole timeline's geometry, and it is deterministic
  // from `layout` (each item's own `estimateSize`).
  const offsets = useMemo(() => {
    const offsets: number[] = [];
    let y = 0;
    for (const item of layout) {
      offsets.push(y);
      y += item.height + GAP;
    }
    return offsets;
  }, [layout]);

  // The scroll element as state, not just the ref: `DateScrubber` has to
  // re-render once it exists, and a ref's mutation doesn't do that.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setScrollEl(ref.current);
  }, [ref]);

  /**
   * How far the container can actually be scrolled, measured from the DOM
   * rather than derived from `layout`, which knows nothing of the viewport
   * height.
   *
   * This is the denominator for everything the scrubber draws and reads —
   * ticks, handle and pill alike — so a year label sits exactly at the
   * scroll position that brings that year to the top, rather than at its
   * fraction of the content, which is a different (and on a short library,
   * a visibly different) number.
   *
   * Re-measured whenever the content or the container's width changes.
   * A resize that changes only the height and leaves the width alone
   * doesn't re-render this component, so the ticks stay put until the next
   * change of either — visible as a small drift in where the labels sit,
   * never as a wrong date.
   */
  const [scrollRange, setScrollRange] = useState(0);
  useEffect(() => {
    const el = ref.current;
    setScrollRange(el ? Math.max(0, el.scrollHeight - el.clientHeight) : 0);
  }, [ref, layout, width]);

  const ticks = useMemo(
    // Shifted into the container's own coordinates: `scrollTop` counts the
    // scroll element's `p-4` top padding and `layout` doesn't.
    () => buildTicks(layout, offsets.map(withPadding), scrollRange, MAX_TICKS),
    [layout, offsets, scrollRange],
  );

  /**
   * The date of the photo at the top of the viewport for a given position
   * along the scrubber, for its pill and its `aria-valuetext`.
   *
   * Resolved from `entries` — the timeline index — and not from the month
   * headers the ticks are built from: a header only knows its month, and
   * the pill's whole job is to say which day the drag has reached.
   */
  const dateAt = useCallback(
    (ratio: number) => {
      const offset = ratio * scrollRange - CONTENT_PADDING;
      const index = tileIndexAtOffset(layout, offsets, offset);
      return index === null ? "" : formatFullDate(entries[index]?.taken_at ?? null);
    },
    [scrollRange, layout, offsets, entries],
  );

  return (
    <div className="relative h-full">
      <div
        ref={ref}
        data-testid="grid-scroll"
        className="scrollbar-none h-full overflow-y-auto p-4"
      >
        <div style={{ position: "relative", height: virtualizer.getTotalSize() }}>
          {virtualItems.map((virtualItem) => {
            const row = layout[virtualItem.index];
            return (
              <div
                key={row.key}
                data-index={virtualItem.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  // Height (row height + GAP, border-box with GAP as bottom
                  // padding) matches `estimateSize` exactly, since row heights
                  // are deterministic from `buildLayout` — no `measureElement`
                  // needed, and no drift between the estimate and the real box.
                  height: row.height + GAP,
                  paddingBottom: GAP,
                  boxSizing: "border-box",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                {row.kind === "header" ? (
                  <MonthHeader
                    label={row.label}
                    count={row.count}
                    ids={row.ids}
                    onSelect={(ids, additive) => onSelectMonth?.(ids, additive)}
                  />
                ) : (
                  <JustifiedRow
                    tiles={row.tiles}
                    items={items}
                    onOpen={onOpen}
                    selectedIds={selectedIds}
                    onToggle={onToggle}
                    focusIndex={focusIndex}
                    selectionMode={selectionMode}
                    onCheckToggle={onCheckToggle}
                    onCheckPointerDown={onCheckPointerDown}
                    onTileEnter={onTileEnter}
                    consumeGestureClick={consumeGestureClick}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/*
        Withheld until there is a timeline to scrub: with no months there
        are no ticks, and an empty track on the edge of an empty grid would
        be a control that does nothing. `isDragging` disables it rather
        than unmounting it, so a drag-select that auto-scrolls the same
        container is the only writer of `scrollTop` while it runs.
      */}
      {ticks.length > 0 && (
        <DateScrubber
          scrollElement={scrollEl}
          ticks={ticks}
          dateAt={dateAt}
          disabled={isDragging}
        />
      )}
    </div>
  );
}

export const VirtualGrid = memo(VirtualGridImpl);
