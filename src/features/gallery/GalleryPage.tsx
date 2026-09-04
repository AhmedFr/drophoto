import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { router } from "@/app/router";
import { PageHeader } from "@/components/PageHeader";
import { PlacePanel } from "@/features/places/components/PlacePanel";
import { moveFocusRow } from "@/lib/media/rowNav";
import { GalleryToolbar } from "./components/GalleryToolbar";
import { Lightbox } from "./components/Lightbox";
import { SelectionBar } from "./components/SelectionBar";
import { TagPanel } from "./components/TagPanel";
import { VirtualGrid } from "./components/VirtualGrid";
import { useMediaCount } from "./hooks/useMediaCount";
import { useMediaInfinite } from "./hooks/useMediaInfinite";
import { DENSITY_ROW_HEIGHT, useGalleryStore } from "./store/galleryStore";

export function GalleryPage() {
  const media = useMediaInfinite();
  const count = useMediaCount();
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
  const items = media.items;

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Opened by `VirtualGrid`'s `onOpen` (and closed by `Lightbox`'s `onClose`).
  const [openIndex, setOpenIndex] = useState<number | null>(null);

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
  // the loaded `items` array; without an anchor it degrades to a plain
  // toggle, per the brief.
  //
  // `useCallback` here is load-bearing, not just tidy: `VirtualGrid` is
  // wrapped in `React.memo`, and an inline function identity that changes
  // every render (as this closes over `items`/`anchorIndex`) would defeat
  // that memoization on every `GalleryPage` render, not just on selection
  // changes.
  const handleToggle = useCallback(
    (index: number, shiftKey: boolean) => {
      if (shiftKey && anchorIndex !== null) {
        const [lo, hi] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
        const ids = items.slice(lo, hi + 1).map((it) => it.row.id);
        selectRange(ids);
        return;
      }
      const item = items[index];
      if (!item) return;
      toggleSelected(item.row.id, index);
    },
    [anchorIndex, items, selectRange, toggleSelected],
  );

  // Same reasoning as `handleToggle` above — kept stable so it doesn't
  // defeat `VirtualGrid`'s memoization on every render.
  const handleNearEnd = useCallback(() => {
    if (media.hasNextPage && !media.isFetchingNextPage) media.fetchNextPage();
  }, [media]);

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
      if (selectedIdsRef.current.length === 0) return;
      e.stopImmediatePropagation();
      clearSelection();
    }
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [clearSelection, tagPanelOpen, metaTagPanelOpen, placePanelOpen, metaPlacePanelOpen]);

  // Grid-level keyboard navigation: ⌘/Ctrl+A selects every *loaded* item
  // (paging is infinite, so that's honestly not necessarily the whole
  // library — SelectionBar's copy says "loaded" for the same reason);
  // Left/Right move the roving focus one item; Up/Down move it a row, via
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
      return items.slice(from, to + 1).map((it) => it.row.id);
    }

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable;
      if (isEditable) return;
      if (openIndex !== null) return;
      if (tagPanelOpen || placePanelOpen || metaTagPanelOpen || metaPlacePanelOpen) return;
      if (items.length === 0) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll(items.map((it) => it.row.id));
        return;
      }

      const current = focusIndex !== null ? Math.min(focusIndex, items.length - 1) : null;

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
          next = Math.min(items.length - 1, current + 1);
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
        const item = items[spaceIndex];
        if (item) toggleSelected(item.row.id, spaceIndex);
        if (current === null) setFocusIndex(spaceIndex);
        return;
      }

      if (e.key === "Enter" && current !== null) {
        e.preventDefault();
        setOpenIndex(current);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    items,
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

  // `items` can shrink out from under an open lightbox (e.g. a refetch after
  // a scan removes media) — clamp `openIndex` back into range, or close it
  // entirely once there's nothing left to show. Adjusted during render
  // (React's documented pattern for state derived from a value that just
  // changed: https://react.dev/learn/you-might-not-need-an-effect) rather
  // than in an effect, so there's no extra frame where a stale, out-of-range
  // index reaches `Lightbox`. The `prevItemsLength` guard makes this run at
  // most once per `items.length` change instead of on every render.
  const [prevItemsLength, setPrevItemsLength] = useState(items.length);
  if (items.length !== prevItemsLength) {
    setPrevItemsLength(items.length);
    if (openIndex !== null && openIndex >= items.length) {
      setOpenIndex(items.length ? items.length - 1 : null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Gallery">
        <GalleryToolbar count={count} />
      </PageHeader>
      <div className="flex-1 overflow-hidden">
        {media.isError && (
          <p className="px-5 pt-5 font-mono text-[11px] text-red-400">{(media.error as Error).message}</p>
        )}
        {media.isSuccess && items.length === 0 ? (
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
            items={items}
            targetRowHeight={DENSITY_ROW_HEIGHT[density]}
            onOpen={setOpenIndex}
            onNearEnd={handleNearEnd}
            selectedIds={selectedIdSet}
            onToggle={handleToggle}
            focusIndex={focusIndex}
            onRowsChange={handleRowsChange}
            onSelectMonth={handleSelectMonth}
          />
        )}
      </div>
      <SelectionBar
        count={selectedIds.length}
        total={items.length}
        onTag={() => setTagPanelOpen(true)}
        onPlace={() => setPlacePanelOpen(true)}
        onClear={clearSelection}
        onSelectAll={() => selectAll(items.map((it) => it.row.id))}
        onInvert={() => invertSelection(items.map((it) => it.row.id))}
      />
      <TagPanel mediaIds={selectedIds} open={tagPanelOpen} onClose={() => setTagPanelOpen(false)} />
      <PlacePanel mediaIds={selectedIds} open={placePanelOpen} onClose={() => setPlacePanelOpen(false)} />
      {openIndex !== null && (
        <Lightbox
          items={items}
          index={openIndex}
          onClose={() => {
            setOpenIndex(null);
            // Guards against a stale `true` outliving the `MetaPanel` that
            // set it (e.g. if the lightbox is ever closed by something
            // other than its own Escape/CLOSE path while the nested panel
            // was left open), which would otherwise permanently block the
            // Escape-clears-selection behavior above.
            setMetaTagPanelOpen(false);
            setMetaPlacePanelOpen(false);
          }}
          onPrev={() => setOpenIndex(openIndex > 0 ? openIndex - 1 : openIndex)}
          onNext={() => {
            if (openIndex < items.length - 1) setOpenIndex(openIndex + 1);
            else if (media.hasNextPage && !media.isFetchingNextPage) media.fetchNextPage();
          }}
          onTagPanelOpenChange={setMetaTagPanelOpen}
          onPlacePanelOpenChange={setMetaPlacePanelOpen}
        />
      )}
    </div>
  );
}
