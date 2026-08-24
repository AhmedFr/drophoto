import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { router } from "@/app/router";
import { PageHeader } from "@/components/PageHeader";
import { PlacePanel } from "@/features/places/components/PlacePanel";
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
  const density = useGalleryStore((s) => s.density);
  const selectedIds = useGalleryStore((s) => s.selectedIds);
  const anchorIndex = useGalleryStore((s) => s.anchorIndex);
  const toggleSelected = useGalleryStore((s) => s.toggleSelected);
  const selectRange = useGalleryStore((s) => s.selectRange);
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

  // Clear the selection when the page unmounts (e.g. navigating away), so a
  // stale selection doesn't linger for the next visit.
  useEffect(() => {
    return () => clearSelection();
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
          </div>
        ) : (
          <VirtualGrid
            items={items}
            targetRowHeight={DENSITY_ROW_HEIGHT[density]}
            onOpen={setOpenIndex}
            onNearEnd={handleNearEnd}
            selectedIds={selectedIdSet}
            onToggle={handleToggle}
          />
        )}
      </div>
      <SelectionBar
        count={selectedIds.length}
        onTag={() => setTagPanelOpen(true)}
        onPlace={() => setPlacePanelOpen(true)}
        onClear={clearSelection}
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
