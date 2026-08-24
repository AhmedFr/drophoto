import type { PlaceCount } from "@/lib/api/places";

export type PlacesMapProps = {
  placeCounts: PlaceCount[];
  onSelectPlace: (placeId: number) => void;
  /** Fired on the underlying MapLibre `Map`'s own `error` event (e.g. a failed style/tile fetch while offline) — `PlacesPage` uses it to fall back to `PlaceList`. */
  onError: () => void;
};
