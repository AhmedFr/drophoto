import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { router } from "@/app/router";
import type { MediaItem } from "@/lib/api/media";
import { PageHeader } from "@/components/PageHeader";
import { PlacePanel } from "@/features/places/components/PlacePanel";
import { moveFocusRow } from "@/lib/media/rowNav";
import { GalleryToolbar } from "./components/GalleryToolbar";
import { Lightbox } from "./components/Lightbox";
import { SelectionBar } from "./components/SelectionBar";
import { TagPanel } from "./components/TagPanel";
import { VirtualGrid } from "./components/VirtualGrid";
import { coveringRange, useMediaChunks } from "./hooks/useMediaChunks";
import { useMediaIndex } from "./hooks/useMediaIndex";
import { DENSITY_ROW_HEIGHT, useGalleryStore } from "./store/galleryStore";

export function GalleryPage() {
  // The whole filtered set as geometry (`entries`), hydrated in chunks
  // around whatever the grid is currently rendering (`items`). The two
  // requests go out together — nothing on screen waits for the index
  // before the first chunk is in flight — and both are indexed by the
  // same absolute position, so `entries[n]` and `items[n]` are the same
  // photo.
  const { entries, key: indexKey, isLoading, isError, error } = useMediaIndex();

  // The tile-index span `VirtualGrid` is currently rendering.
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 0 });

  // Opened by `VirtualGrid`'s `onOpen` (and closed by `Lightbox`'s
  // `onClose`). Declared up here because hydration has to cover it: with
  // paging gone, next/prev walk the whole set, so the chunks fetched must
  // follow the lightbox and not just the grid.
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const hydrationRange = useMemo(
    () => coveringRange(visibleRange, openIndex),
    [visibleRange, openIndex],
  );

  const { items: hydrated, key: chunksKey } = useMediaChunks(hydrationRange);

  const searchQuery = useGalleryStore((s) => s.query);
  const density = useGalleryStore((s) => s.density);
  const selectedIds = useGalleryStore((s) => s.selectedIds);
  const anchorIndex = useGalleryStore((s) => s.anchorIndex);
  const focusIndex = useGalleryStore((s) => s.focusIndex);
  const setFocusIndex = useGalleryStore((s) => s.setFocusIndex);
  const setAnchorIndex = useGalleryStore((s) => s.setAnchorIndex);
  const toggleSelected = useGalleryStore((s) => s.toggleSelected);
  const selectRange = useGalleryStore((s) => s.selectRange);
  const deselectRange = useGalleryStore((s) => s.deselectRange);
  const selectAll = useGalleryStore((s) => s.selectAll);
  const invertSelection = useGalleryStore((s) => s.invertSelection);
  const clearSelection = useGalleryStore((s) => s.clearSelection);

  // The geometry (`entries`) and the rows (`hydrated`) are cached
  // separately and resolve at different speeds, and both hold the outgoing
  // selection through a settle — so either can be a generation behind the
  // other after a filter, sort or search change. Rows are painted only
  // while the two agree; when they don't, the grid falls back to
  // placeholders over the index's geometry. The invariant this buys: a
  // tile never shows a thumbnail belonging to a different photo than its
  // own id.
  const sameGeneration = indexKey !== null && indexKey === chunksKey;

  // `useMediaChunks` only fills the slots it has hydrated, so its `length`
  // stops wherever the highest loaded chunk ends. `Lightbox` reads
  // `items.length` as the set's total ("03 / 17405"), so it's given a view
  // of the same sparse array sized to the whole timeline instead.
  const items = useMemo(() => {
    const sized: (MediaItem | undefined)[] = sameGeneration
      ? hydrated.slice(0, entries.length)
      : [];
    sized.length = entries.length;
    return sized;
  }, [hydrated, entries.length, sameGeneration]);

  // Read from the `document` keydown handlers below, which must not be
  // torn down and re-added every time a chunk lands. Same pattern as
  // `selectedIdsRef`.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Whether the index has actually answered. Until then the toolbar count
  // stays hidden and the empty state is withheld, rather than briefly
  // claiming an empty library.
  const loaded = !isLoading && !isError;

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Opened by `SelectionBar`'s TAG button, for the current selection.
  const [tagPanelOpen, setTagPanelOpen] = useState(false);

  // Opened by `SelectionBar`'s PLACE button, for the current selection.
  const [placePanelOpen, setPlacePanelOpen] = useState(false);

  // Mirrors whether `Lightbox`'s `MetaPanel` currently has its own
  // (single-id) `TagPanel`/`PlacePanel` open — see the Escape handler
  // below.
  const [metaTagPanelOpen, setMetaTagPanelOpen] = useState(false);
  const [metaPlacePanelOpen, setMetaPlacePanelOpen] = useState(false);

  // `onToggle` from `Tile`/`VirtualGrid`: `shiftKey` false is a plain
  // (cmd/ctrl-click) toggle, `shiftKey` true is a shift-range select. Range
  // selection computes ids between the anchor and `index` (inclusive) over
  // the timeline index — so it spans photos whose rows haven't been
  // hydrated yet; without an anchor it degrades to a plain toggle, per the
  // brief.
  //
  // `useCallback` here is load-bearing, not just tidy: `VirtualGrid` is
  // wrapped in `React.memo`, and an inline function identity that changes
  // every render (as this closes over `entries`/`anchorIndex`) would defeat
  // that memoization on every `GalleryPage` render, not just on selection
  // changes.
  const handleToggle = useCallback(
    (index: number, shiftKey: boolean) => {
      if (shiftKey && anchorIndex !== null) {
        const [lo, hi] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
        const ids = entries.slice(lo, hi + 1).map((e) => e.id);
        selectRange(ids);
        return;
      }
      const entry = entries[index];
      if (!entry) return;
      toggleSelected(entry.id, index);
    },
    [anchorIndex, entries, selectRange, toggleSelected],
  );

  // Same reasoning as `handleToggle` above — kept stable so it doesn't
  // defeat `VirtualGrid`'s memoization on every render. The identity guard
  // also keeps the grid's own report from bouncing back as a fresh object
  // and re-keying the chunk queries for an unchanged range.
  const handleRangeChange = useCallback((next: { start: number; end: number }) => {
    setVisibleRange((prev) =>
      prev.start === next.start && prev.end === next.end ? prev : next,
    );
  }, []);

  // `VirtualGrid`'s justified layout has no fixed items-per-row count, so
  // the keyboard Up/Down handler below needs the real row grouping to move
  // "a row" at a time. Kept in a ref (not state) since it's consumed
  // imperatively from a keydown handler and changes far more often (on
  // every resize/page-in) than it needs to trigger a `GalleryPage`
  // re-render.
  const rowsRef = useRef<number[][]>([]);
  const handleRowsChange = useCallback((rows: number[][]) => {
    rowsRef.current = rows;
  }, []);

  // Closing the lightbox, from either of its two paths: `Lightbox`'s own
  // `onClose`, or the Escape handler below when there is no `Lightbox`
  // rendered to receive the keystroke.
  const closeLightbox = useCallback(() => {
    setOpenIndex(null);
    // Guards against a stale `true` outliving the `MetaPanel` that set it
    // (e.g. if the lightbox is ever closed by something other than its own
    // Escape/CLOSE path while the nested panel was left open), which would
    // otherwise permanently block the Escape-clears-selection behavior
    // below.
    setMetaTagPanelOpen(false);
    setMetaPlacePanelOpen(false);
  }, []);

  // `MonthHeader`'s select action: a plain click replaces the selection
  // with just this section (`selectAll`); cmd/ctrl-click adds it to
  // whatever's already selected (`selectRange`), matching cmd-click's
  // meaning everywhere else in the grid.
  const handleSelectMonth = useCallback(
    (ids: number[], additive: boolean) => {
      if (additive) selectRange(ids);
      else selectAll(ids);
    },
    [selectRange, selectAll],
  );

  // Clear the selection when the page unmounts (e.g. navigating away), so a
  // stale selection doesn't linger for the next visit. The roving keyboard
  // focus is cleared alongside it — otherwise it'd persist in the store
  // (which isn't torn down between mounts) and point at whatever index
  // happened to be focused in a totally different query the next time this
  // page mounts.
  useEffect(() => {
    return () => {
      clearSelection();
      setFocusIndex(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape clears a non-empty selection instead of falling through to
  // Radix's `Dialog.Content`, which also closes the lightbox on Escape via
  // its own `document`-level, capture-phase listener (see
  // `@radix-ui/react-dismissable-layer`). Registering our listener here —
  // on `document`, in the capture phase, as soon as `GalleryPage` mounts —
  // guarantees it runs before that one (same-node capture listeners fire in
  // registration order, and this mounts well before any `Lightbox` can).
  // `stopImmediatePropagation` then keeps the keystroke from reaching Radix's
  // listener, so a selected + open lightbox stays open while the selection
  // clears; with no selection, the event passes through untouched and
  // Escape closes the lightbox as before.
  //
  // Either `TagPanel`/`PlacePanel` (the selection ones, or `MetaPanel`'s
  // single-id ones nested in the lightbox) being open takes priority over
  // all of that: we yield immediately, without touching the selection, so
  // the keystroke reaches that dialog's own Radix `DismissableLayer` and
  // closes only the topmost (nested-most) open dialog — leaving the
  // background selection and, when applicable, the lightbox itself intact.
  //
  // `selectedIds` is read via a ref (updated every render, no dependency
  // array of its own) rather than as an effect dependency, so the
  // `document` listener isn't torn down and re-added on every toggle —
  // only when `clearSelection`'s identity would ever change. The two
  // panel-open flags are cheap to flip (far less often than a selection
  // toggle) so they're plain effect dependencies instead.
  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (tagPanelOpen || metaTagPanelOpen || placePanelOpen || metaPlacePanelOpen) return;
      if (selectedIdsRef.current.length > 0) {
        e.stopImmediatePropagation();
        clearSelection();
        return;
      }
      // A lightbox opened onto a row whose chunk hasn't landed renders
      // nothing at all, so there is no Radix dismissable layer to receive
      // this keystroke — close it from here instead. Without this the page
      // would be keyboard-dead: the grid handler below yields to the
      // lightbox whenever `openIndex` is set, so nothing would answer any
      // key until the user reached for the mouse. Ordered *after* the
      // selection branch so it matches what a hydrated lightbox does (its
      // Radix layer only ever sees the keystroke once the selection is
      // already clear).
      if (openIndex !== null && itemsRef.current[openIndex] === undefined) {
        e.stopImmediatePropagation();
        closeLightbox();
      }
    }
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [
    clearSelection,
    closeLightbox,
    openIndex,
    tagPanelOpen,
    metaTagPanelOpen,
    placePanelOpen,
    metaPlacePanelOpen,
  ]);

  // Grid-level keyboard navigation: ⌘/Ctrl+A selects every item in the
  // current filter (the timeline index covers the whole filtered set, not
  // a page); Left/Right move the roving focus one item; Up/Down move it a row, via
  // `rowsRef` (see above — the justified layout has no fixed
  // items-per-row); Space toggles the focused item; Enter opens it in the
  // lightbox; Shift+Arrow extends/shrinks the selection from the anchor as
  // focus moves.
  //
  // Must not fire while the user is typing (the toolbar search box, or any
  // future input/textarea/contenteditable) or while a dialog/lightbox is
  // up front — those own the keyboard while they're open. Registered on
  // `document` in the ordinary bubble phase (unlike the Escape handler
  // above): nothing else on the page needs to be pre-empted before it.
  useEffect(() => {
    function idsInRange(lo: number, hi: number): number[] {
      const [from, to] = lo <= hi ? [lo, hi] : [hi, lo];
      return entries.slice(from, to + 1).map((e) => e.id);
    }

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable;
      if (isEditable) return;
      if (openIndex !== null) return;
      if (tagPanelOpen || placePanelOpen || metaTagPanelOpen || metaPlacePanelOpen) return;
      if (entries.length === 0) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll(entries.map((entry) => entry.id));
        return;
      }

      const current = focusIndex !== null ? Math.min(focusIndex, entries.length - 1) : null;

      if (
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown"
      ) {
        e.preventDefault();
        let next: number;
        if (current === null) {
          // Nothing focused yet — any arrow just establishes focus at the
          // first item, matching a fresh listbox's initial keyboard state.
          next = 0;
        } else if (e.key === "ArrowLeft") {
          next = Math.max(0, current - 1);
        } else if (e.key === "ArrowRight") {
          next = Math.min(entries.length - 1, current + 1);
        } else {
          next = moveFocusRow(rowsRef.current, current, e.key === "ArrowUp" ? -1 : 1);
        }

        if (e.shiftKey && current !== null) {
          // Keyboard Shift+Arrow is a continuous drag from the anchor — unlike
          // a single shift-click, both the anchor and the *previous* focus are
          // known, so the range can grow (selectRange) or shrink
          // (deselectRange) precisely as focus moves, instead of only adding.
          const anchor = anchorIndex ?? current;
          if (anchorIndex === null) setAnchorIndex(anchor);
          const oldRange = new Set(idsInRange(anchor, current));
          const newRangeIds = idsInRange(anchor, next);
          const newRange = new Set(newRangeIds);
          // The WHOLE new range is offered to `selectRange` (which ignores
          // ids already selected) rather than just the ids the range gained.
          // A plain Arrow sets the anchor without selecting it, so on the
          // first Shift+Arrow the anchor's own id is still unselected — a
          // difference-only add would silently skip it and start the range
          // one item short.
          const toRemove = [...oldRange].filter((id) => !newRange.has(id));
          selectRange(newRangeIds);
          if (toRemove.length > 0) deselectRange(toRemove);
        } else {
          // A plain Arrow re-anchors at the new focus, same as a plain click
          // moving `anchorIndex` via `toggleSelected` — it doesn't select
          // anything itself, but it's where the next Shift+Arrow drag starts.
          setAnchorIndex(next);
        }
        setFocusIndex(next);
        return;
      }

      if (e.key === " ") {
        e.preventDefault();
        const spaceIndex = current ?? 0;
        const entry = entries[spaceIndex];
        if (entry) toggleSelected(entry.id, spaceIndex);
        if (current === null) setFocusIndex(spaceIndex);
        return;
      }

      if (e.key === "Enter" && current !== null) {
        e.preventDefault();
        // Same rule `Tile` applies to a click: a row whose chunk hasn't
        // landed has nothing to show, and opening onto it would strand the
        // page in a lightbox that renders nothing.
        if (itemsRef.current[current]) setOpenIndex(current);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    entries,
    focusIndex,
    anchorIndex,
    openIndex,
    tagPanelOpen,
    placePanelOpen,
    metaTagPanelOpen,
    metaPlacePanelOpen,
    selectAll,
    selectRange,
    deselectRange,
    setFocusIndex,
    setAnchorIndex,
    toggleSelected,
  ]);

  // The set can shrink out from under an open lightbox (e.g. a refetch
  // after a scan removes media) — clamp `openIndex` back into range, or
  // close it entirely once there's nothing left to show. Adjusted during
  // render (React's documented pattern for state derived from a value that
  // just changed: https://react.dev/learn/you-might-not-need-an-effect)
  // rather than in an effect, so there's no extra frame where a stale,
  // out-of-range index reaches `Lightbox`. The `prevCount` guard makes this
  // run at most once per `entries.length` change instead of on every render.
  const [prevCount, setPrevCount] = useState(entries.length);
  if (entries.length !== prevCount) {
    setPrevCount(entries.length);
    if (openIndex !== null && openIndex >= entries.length) {
      setOpenIndex(entries.length ? entries.length - 1 : null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Gallery">
        <GalleryToolbar count={loaded ? entries.length : undefined} />
      </PageHeader>
      <div className="flex-1 overflow-hidden">
        {isError && (
          <p className="px-5 pt-5 font-mono text-[11px] text-red-400">{(error as Error).message}</p>
        )}
        {loaded && entries.length === 0 ? (
          <div className="p-5 font-mono text-[11px] text-faint">
            {searchQuery.trim() ? (
              `No photos match "${searchQuery.trim()}"`
            ) : (
              <>
                No media yet — register and scan a{" "}
                {/*
                  The feature registry (`src/app/registry.ts`) types each
                  module's route `path` as a plain `string`, so the router's
                  generated route tree loses literal path types and can't
                  type-check `to` against the app's real routes (the same
                  reason `Sidebar` navigates with a plain `<a>` + `onNavigate`
                  instead of `Link`). Widening the generics here keeps this a
                  real `Link` — with active-state and prefetch support — while
                  avoiding an unchecked `to` string.
                */}
                <Link<typeof router, string, string> to="/drives" className="underline">
                  drive
                </Link>
                .
              </>
            )}
          </div>
        ) : (
          <VirtualGrid
            entries={entries}
            items={items}
            targetRowHeight={DENSITY_ROW_HEIGHT[density]}
            onOpen={setOpenIndex}
            selectedIds={selectedIdSet}
            onToggle={handleToggle}
            focusIndex={focusIndex}
            onRowsChange={handleRowsChange}
            onRangeChange={handleRangeChange}
            onSelectMonth={handleSelectMonth}
          />
        )}
      </div>
      <SelectionBar
        count={selectedIds.length}
        total={entries.length}
        onTag={() => setTagPanelOpen(true)}
        onPlace={() => setPlacePanelOpen(true)}
        onClear={clearSelection}
        onSelectAll={() => selectAll(entries.map((entry) => entry.id))}
        onInvert={() => invertSelection(entries.map((entry) => entry.id))}
      />
      <TagPanel mediaIds={selectedIds} open={tagPanelOpen} onClose={() => setTagPanelOpen(false)} />
      <PlacePanel mediaIds={selectedIds} open={placePanelOpen} onClose={() => setPlacePanelOpen(false)} />
      {openIndex !== null && (
        <Lightbox
          items={items}
          index={openIndex}
          onClose={closeLightbox}
          onPrev={() => setOpenIndex(openIndex > 0 ? openIndex - 1 : openIndex)}
          onNext={() => {
            if (openIndex < entries.length - 1) setOpenIndex(openIndex + 1);
          }}
          onTagPanelOpenChange={setMetaTagPanelOpen}
          onPlacePanelOpenChange={setMetaPlacePanelOpen}
        />
      )}
    </div>
  );
}
