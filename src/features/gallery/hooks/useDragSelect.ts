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

  // Whether the `click` the browser is about to synthesise belongs to a
  // gesture this hook already applied, and must therefore be ignored.
  //
  // It has to be answered here, not at the element that was pressed. Per
  // UI Events, when a press and its release have different targets the
  // `click` is dispatched on their nearest common ancestor — so pressing a
  // tile's checkmark and drifting a few pixels onto the tile before
  // releasing sends the click to the *tile*, which would then run its own
  // click handling on top of the gesture: toggling the selection straight
  // back off, or (once that empties the selection and drops the gallery
  // out of selection mode) opening the lightbox from a checkmark press.
  // `preventDefault()` on pointerdown does not help — it suppresses the
  // compatibility `mousedown`, not `click`.
  const pendingClick = useRef(false);

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
      //
      // The origin is cleared rather than left alone: a bail *during* a
      // live drag has to end that drag too, or its subsequent moves would
      // keep writing a selection anchored to a position that isn't there.
      if (!entry) {
        origin.current = null;
        setIsDragging(false);
        return;
      }
      pendingClick.current = true;
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

  /**
   * Whether the click now being handled was produced by a checkmark press
   * this hook already acted on — read once, then cleared. Tiles call it
   * from both their body and their checkmark click handlers, since either
   * can be where the browser lands the click.
   */
  const consumeGestureClick = useCallback(() => {
    const pending = pendingClick.current;
    pendingClick.current = false;
    return pending;
  }, []);

  // A press that ends without any click reaching a tile — released outside
  // the window, or over the gap between two tiles — would otherwise leave
  // the flag raised for the next, unrelated click to swallow. Every click
  // is preceded by a press, so clearing at the start of the next press
  // bounds that: this runs in the capture phase, ahead of React's own
  // delegated `pointerdown`, so a checkmark press still raises the flag
  // afterwards.
  useEffect(() => {
    const clear = () => {
      pendingClick.current = false;
    };
    document.addEventListener("pointerdown", clear, { capture: true });
    return () => document.removeEventListener("pointerdown", clear, { capture: true });
  }, []);

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

  return { onCheckPointerDown, onTileEnter, isDragging, consumeGestureClick };
}
