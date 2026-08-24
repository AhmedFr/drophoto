import { useEffect, useRef } from "react";
import { Map as MaplibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { PLACES_MAP_STYLE_URL } from "./PlacesMap.constants";
import type { PlacesMapProps } from "./PlacesMap.types";

/**
 * The map pane of `PlacesPage`: one marker per place, labeled with its
 * media count, over the dark OpenFreeMap style. `components` never import
 * `@tauri-apps/*` — this one doesn't need to, MapLibre talks to
 * `tiles.openfreemap.org` directly (allowed by the CSP's `connect-src`).
 *
 * Split into two effects: the map instance itself is created once (empty
 * dependency array) and torn down on unmount, while markers are
 * synced separately whenever `placeCounts` changes, without recreating the
 * whole map. `onSelectPlace`/`onError` are read through refs so neither
 * effect has to depend on (and be torn down/rebuilt over) a new callback
 * identity on every parent render.
 */
export function PlacesMap({ placeCounts, onSelectPlace, onError }: PlacesMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);

  // Assigned in an effect, not directly during render — mutating a ref's
  // `.current` while rendering is unsafe (see `GalleryPage`'s
  // `selectedIdsRef` for the same pattern).
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const onSelectPlaceRef = useRef(onSelectPlace);
  useEffect(() => {
    onSelectPlaceRef.current = onSelectPlace;
  }, [onSelectPlace]);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MaplibreMap({
      container: containerRef.current,
      style: PLACES_MAP_STYLE_URL,
      center: [0, 20],
      zoom: 1.2,
    });
    mapRef.current = map;

    function handleError() {
      onErrorRef.current();
    }
    map.on("error", handleError);

    return () => {
      map.off("error", handleError);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers = placeCounts.map(({ place, count }) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "places-map-marker";
      el.setAttribute("aria-label", `${place.name} (${count})`);
      el.textContent = String(count);
      el.addEventListener("click", () => onSelectPlaceRef.current(place.id));
      return new Marker({ element: el }).setLngLat([place.lon, place.lat]).addTo(map);
    });

    return () => {
      for (const marker of markers) marker.remove();
    };
  }, [placeCounts]);

  return <div ref={containerRef} data-testid="places-map" className="h-full w-full" />;
}
