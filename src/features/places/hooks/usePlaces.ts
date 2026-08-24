import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listPlaceCounts } from "@/lib/api/places";

/**
 * Drives `PlacesPage`'s data: the `["places"]` query behind both the map
 * and the offline `PlaceList`, plus whether the page should be showing the
 * map at all.
 *
 * `online` starts from `navigator.onLine` at mount — read once via a lazy
 * `useState` initializer rather than a `window` `online`/`offline`
 * listener, since a live network flap mid-session is instead caught by
 * `PlacesMap`'s own `error` event (MapLibre failing to fetch style/tiles is
 * the more direct offline signal for *this* map, and the one the brief
 * calls out) via `reportMapError`. Once flipped, `online` stays `false` for
 * the rest of the page's lifetime — there's no map instance left to retry
 * against without remounting the whole page.
 */
export function usePlaces() {
  const placesQuery = useQuery({
    queryKey: ["places"],
    queryFn: listPlaceCounts,
  });

  const [online, setOnline] = useState(() => navigator.onLine);

  function reportMapError() {
    setOnline(false);
  }

  return {
    placeCounts: placesQuery.data ?? [],
    isLoading: placesQuery.isLoading,
    isError: placesQuery.isError,
    error: placesQuery.isError ? (placesQuery.error as Error).message : null,
    online,
    reportMapError,
  };
}
