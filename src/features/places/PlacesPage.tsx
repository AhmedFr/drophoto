import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { DotLoader } from "@/components/DotLoader";
import { Button } from "@/components/ui/button";
import { Lightbox } from "@/features/gallery/components/Lightbox";
import { VirtualGrid } from "@/features/gallery/components/VirtualGrid";
import { DENSITY_ROW_HEIGHT } from "@/features/gallery/store/galleryStore";
import { queryMedia } from "@/lib/api/media";
import { startGeocode } from "@/lib/api/places";
import { PlaceList } from "./components/PlaceList";
import { PlacesMap } from "./components/PlacesMap";
import { usePlaces } from "./hooks/usePlaces";

// Selected-place results aren't paged (a single place's photos are a small,
// bounded set — no reason to reach for `useMediaInfinite`'s cursor
// machinery here), so just the gallery's normal ("Comfortable") row height
// reused, same reasoning as `SearchPage`.
const ROW_HEIGHT = DENSITY_ROW_HEIGHT.Comfortable;

const EMPTY_SELECTION = new Set<number>();

// The place-filtered grid supports plain-click-to-open only (no
// multi-select) — `VirtualGrid` still requires an `onToggle`, so this is
// the no-op passed for it, same as `SearchPage`.
function noopToggle() {}

/** Every media item assigned to `placeId`, via the same `query_media` client the gallery/search pages use. `null` disables the query entirely (nothing selected yet). */
function usePlaceMedia(placeId: number | null) {
  return useQuery({
    // Prefixed with "media" (not a separate top-level key) so `PlacePanel`'s
    // `invalidateQueries({ queryKey: ["media"] })` after a manual override
    // also refreshes whichever place is currently open here.
    queryKey: ["media", "place", placeId],
    queryFn: () =>
      queryMedia({ kinds: [], exts: [], sort: "taken_desc", limit: 2000, offset: 0, place_id: placeId }),
    enabled: placeId !== null,
  });
}

export function PlacesPage() {
  const { placeCounts, isLoading, online, reportMapError } = usePlaces();
  const [selectedPlaceId, setSelectedPlaceId] = useState<number | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const mediaQuery = usePlaceMedia(selectedPlaceId);
  const items = mediaQuery.data ?? [];

  // Results can shrink out from under an open lightbox (switching places,
  // or a refetch after a manual override) — clamp instead of leaving a
  // stale, out-of-range index. Same pattern as `GalleryPage`/`SearchPage`.
  const [prevLength, setPrevLength] = useState(items.length);
  if (items.length !== prevLength) {
    setPrevLength(items.length);
    if (openIndex !== null && openIndex >= items.length) {
      setOpenIndex(items.length ? items.length - 1 : null);
    }
  }

  const isEmpty = !isLoading && placeCounts.length === 0;

  function handleGeocode() {
    // Fire-and-forget — a toast surfaces progress/completion through the
    // job system elsewhere, this call just needs to kick the sweep off.
    startGeocode().catch(() => {});
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Places">
        <Button
          variant="outline"
          size="sm"
          className="font-mono text-[10.5px] tracking-[1.5px]"
          onClick={handleGeocode}
        >
          GEOCODE NOW
        </Button>
      </PageHeader>
      <div className="flex flex-1 overflow-hidden">
        <div className="min-w-0 flex-1">
          {isLoading && (
            <div className="p-5">
              <DotLoader label="Loading places…" />
            </div>
          )}
          {isEmpty && (
            <div className="p-5 font-mono text-[11px] tracking-[0.8px] text-faint">
              NO PLACES YET — photos with GPS are placed automatically after a scan. Press GEOCODE NOW to
              place existing photos, or select photos and press PLACE.
            </div>
          )}
          {!isLoading &&
            !isEmpty &&
            (online ? (
              <PlacesMap placeCounts={placeCounts} onSelectPlace={setSelectedPlaceId} onError={reportMapError} />
            ) : (
              <PlaceList placeCounts={placeCounts} onSelectPlace={setSelectedPlaceId} />
            ))}
          {!isLoading && !isEmpty && (
            // I1: GeoNames (place names/coords) and OpenFreeMap/OpenStreetMap
            // (map tiles) both require attribution wherever their data is
            // shown — one line, present regardless of which view (map or
            // offline list) is active. See THIRD-PARTY.md for the full notice.
            <div className="border-t border-border p-2 text-center font-mono text-[9.5px] tracking-[0.8px] text-faint">
              PLACE DATA © GEONAMES (CC BY 4.0) · MAP © OPENFREEMAP / OPENSTREETMAP
            </div>
          )}
        </div>
        {selectedPlaceId !== null && (
          <aside className="w-[420px] shrink-0 overflow-y-auto border-l border-border">
            <VirtualGrid
              items={items}
              targetRowHeight={ROW_HEIGHT}
              onOpen={setOpenIndex}
              selectedIds={EMPTY_SELECTION}
              onToggle={noopToggle}
            />
          </aside>
        )}
      </div>
      {openIndex !== null && (
        <Lightbox
          items={items}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onPrev={() => setOpenIndex(openIndex > 0 ? openIndex - 1 : openIndex)}
          onNext={() => setOpenIndex(openIndex < items.length - 1 ? openIndex + 1 : openIndex)}
        />
      )}
    </div>
  );
}
