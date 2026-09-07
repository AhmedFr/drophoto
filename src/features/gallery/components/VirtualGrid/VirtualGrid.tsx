import { memo, useEffect, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { buildLayout, GAP, type LayoutItem } from "@/lib/media/layout";
import { JustifiedRow } from "./JustifiedRow";
import { MonthHeader } from "./MonthHeader";
import { useContainerWidth } from "./useContainerWidth";
import { useEdgeAutoScroll } from "./useEdgeAutoScroll";
import type { VirtualGridProps } from "./VirtualGrid.types";

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

  return (
    <div ref={ref} className="h-full overflow-y-auto p-4">
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
  );
}

export const VirtualGrid = memo(VirtualGridImpl);
