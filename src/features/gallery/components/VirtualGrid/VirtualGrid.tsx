import { memo, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { buildLayout, GAP, type LayoutItem } from "@/lib/media/layout";
import { JustifiedRow } from "./JustifiedRow";
import { MonthHeader } from "./MonthHeader";
import { useContainerWidth } from "./useContainerWidth";
import type { VirtualGridProps } from "./VirtualGrid.types";

function VirtualGridImpl({
  items,
  targetRowHeight,
  onOpen,
  onNearEnd,
  selectedIds,
  onToggle,
  focusIndex = null,
  onRowsChange,
  onSelectMonth,
}: VirtualGridProps) {
  // `useContainerWidth` measures `contentRect.width`, which already excludes
  // the scroll element's `p-4` padding — no further subtraction needed here.
  const { ref, width } = useContainerWidth<HTMLDivElement>();

  const layout = useMemo(
    () => buildLayout(items, width, targetRowHeight),
    [items, width, targetRowHeight],
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
  // whenever width, items, or row height change) keeps them in sync.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, layout]);

  // Row grouping (each row as its tiles' `items`-array indices, in column
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
  const maxIndex = virtualItems.reduce((max, v) => Math.max(max, v.index), -1);

  // Fires `onNearEnd` at most once per distinct layout length, so paging in
  // more items (which grows the layout) re-arms the check.
  const notifiedLength = useRef<number | null>(null);
  useEffect(() => {
    if (!onNearEnd || layout.length === 0) return;
    if (maxIndex >= layout.length - 3 && notifiedLength.current !== layout.length) {
      notifiedLength.current = layout.length;
      onNearEnd();
    }
  }, [maxIndex, layout.length, onNearEnd]);

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
                  onOpen={onOpen}
                  selectedIds={selectedIds}
                  onToggle={onToggle}
                  focusIndex={focusIndex}
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
