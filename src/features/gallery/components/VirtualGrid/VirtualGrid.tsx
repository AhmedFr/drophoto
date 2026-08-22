import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { buildLayout, GAP } from "@/lib/media/layout";
import { JustifiedRow } from "./JustifiedRow";
import { MonthHeader } from "./MonthHeader";
import { useContainerWidth } from "./useContainerWidth";
import type { VirtualGridProps } from "./VirtualGrid.types";

const PADDING = 32; // p-4 on both sides of the scroll element

export function VirtualGrid({ items, targetRowHeight, onOpen, onNearEnd }: VirtualGridProps) {
  const { ref, width } = useContainerWidth<HTMLDivElement>();

  const layout = useMemo(
    () => buildLayout(items, width - PADDING, targetRowHeight),
    [items, width, targetRowHeight],
  );

  const virtualizer = useVirtualizer({
    count: layout.length,
    getScrollElement: () => ref.current,
    estimateSize: (i) => layout[i].height + GAP,
    overscan: 6,
  });

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
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {row.kind === "header" ? (
                <MonthHeader label={row.label} count={row.count} />
              ) : (
                <JustifiedRow tiles={row.tiles} onOpen={onOpen} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
