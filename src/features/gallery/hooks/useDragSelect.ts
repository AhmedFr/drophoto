import { useCallback, useEffect, useRef, useState } from "react";
import type { LayoutEntry } from "@/lib/media/layout";

type Args = {
  /**
   * The whole filtered set as geometry — the same timeline index the grid
   * lays out from. Ranges are computed over it, so a drag spans photos
   * whose rows haven't been hydrated yet.
   */
  entries: LayoutEntry[];
  /** The live selection — snapshotted when a drag begins. */
  selectedIds: number[];
  /** Called with the complete desired selection on every move. */
  onSelectionChange: (ids: number[]) => void;
};

/**
 * The Google Photos drag-select gesture: press a tile's checkmark and
 * sweep across its neighbours.
 *
 * The selection is *recomputed from a snapshot* on every move rather than
 * accumulated. That is what makes a reversed drag undo itself — pulling
 * back shrinks the range, so the tiles it passed fall out of the result
 * instead of being stranded selected — and it is also what keeps a
 * selection made before the drag from being clobbered by it. The caller
 * therefore receives the *complete desired selection*, not a list of ids to
 * add, and replaces the selection outright with it.
 *
 * The drag's direction of effect is fixed at its origin: if the origin
 * tile was unselected the sweep selects, if it was already selected the
 * sweep deselects.
 */
export function useDragSelect({ entries, selectedIds, onSelectionChange }: Args) {
  const [isDragging, setIsDragging] = useState(false);
  const origin = useRef<number | null>(null);
  const mode = useRef<"select" | "deselect">("select");
  const snapshot = useRef<number[]>([]);

  const apply = useCallback(
    (from: number, to: number) => {
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      const range = new Set(entries.slice(lo, hi + 1).map((e) => e.id));
      if (mode.current === "select") {
        // Snapshot first, then the swept ids it didn't already contain —
        // insertion order stays stable as the drag grows.
        const kept = snapshot.current;
        const keptSet = new Set(kept);
        const added = [...range].filter((id) => !keptSet.has(id));
        onSelectionChange([...kept, ...added]);
      } else {
        onSelectionChange(snapshot.current.filter((id) => !range.has(id)));
      }
    },
    [entries, onSelectionChange],
  );

  const onCheckPointerDown = useCallback(
    (index: number, event: { preventDefault: () => void }) => {
      // Stops the browser starting a native image drag mid-gesture, which
      // would take the pointer stream with it and strand the sweep.
      event.preventDefault();
      const entry = entries[index];
      // The index and the entries are cached separately, so a tile can
      // report a position this array no longer covers. Nothing to select
      // from a position that doesn't exist — and no gesture to start.
      if (!entry) return;
      origin.current = index;
      snapshot.current = selectedIds;
      mode.current = selectedIds.includes(entry.id) ? "deselect" : "select";
      setIsDragging(true);
      // The press is itself a toggle: the tile answers under the finger,
      // before any movement. Everything after is the same recomputation
      // with a wider range.
      apply(index, index);
    },
    [apply, entries, selectedIds],
  );

  const onTileEnter = useCallback(
    (index: number) => {
      if (origin.current === null) return;
      apply(origin.current, index);
    },
    [apply],
  );

  // Listening on `document` (not the grid) means a release anywhere —
  // outside the window included — ends the gesture, so a drag can never
  // get stuck "live" after the pointer is already up.
  useEffect(() => {
    if (!isDragging) return;
    const end = () => {
      origin.current = null;
      setIsDragging(false);
    };
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    return () => {
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
    };
  }, [isDragging]);

  return { onCheckPointerDown, onTileEnter, isDragging };
}
