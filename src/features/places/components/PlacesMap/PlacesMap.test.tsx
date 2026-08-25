import { render } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import type { PlaceCount } from "@/lib/api/places";
import { maplibreMockFactory, type MaplibreSpies } from "@/test/mockMaplibre";
import { PlacesMap } from "./PlacesMap";
import { PLACES_MAP_STYLE_URL } from "./PlacesMap.constants";

const maplibreSpies = vi.hoisted<MaplibreSpies>(() => ({ maps: [], markers: [] }));
vi.mock("maplibre-gl", () => maplibreMockFactory(maplibreSpies));

function pc(id: number, name: string, lat: number, lon: number, count: number): PlaceCount {
  return {
    place: { id, lat, lon, name, admin: null, country: "Portugal", source: "geocoder" },
    count,
  };
}

beforeEach(() => {
  maplibreSpies.maps.length = 0;
  maplibreSpies.markers.length = 0;
});

it("creates a map against the dark OpenFreeMap style", () => {
  render(<PlacesMap placeCounts={[]} onSelectPlace={() => {}} onError={() => {}} />);

  expect(maplibreSpies.maps).toHaveLength(1);
  expect(maplibreSpies.maps[0].options.style).toBe(PLACES_MAP_STYLE_URL);
});

it("creates one marker per place, positioned at its lon/lat", () => {
  render(
    <PlacesMap
      placeCounts={[pc(1, "Lisbon", 38.7, -9.1, 5), pc(2, "Porto", 41.1, -8.6, 2)]}
      onSelectPlace={() => {}}
      onError={() => {}}
    />,
  );

  expect(maplibreSpies.markers).toHaveLength(2);
  expect(maplibreSpies.markers[0].lngLat).toEqual([-9.1, 38.7]);
  expect(maplibreSpies.markers[1].lngLat).toEqual([-8.6, 41.1]);
});

it("labels each marker's element with the place name and count", () => {
  render(<PlacesMap placeCounts={[pc(1, "Lisbon", 38.7, -9.1, 5)]} onSelectPlace={() => {}} onError={() => {}} />);

  const [marker] = maplibreSpies.markers;
  expect(marker.getElement().getAttribute("aria-label")).toBe("Lisbon (5)");
  expect(marker.getElement().textContent).toBe("5");
});

it("styles the marker element so it renders as a visible, clickable badge (not bare text)", () => {
  render(<PlacesMap placeCounts={[pc(1, "Lisbon", 38.7, -9.1, 5)]} onSelectPlace={() => {}} onError={() => {}} />);

  const [marker] = maplibreSpies.markers;
  const classList = marker.getElement().className;
  expect(classList.split(/\s+/).filter(Boolean).length).toBeGreaterThan(1);
  expect(classList).toContain("cursor-pointer");
});

it("calls onSelectPlace with the place id when a marker is clicked", () => {
  const onSelectPlace = vi.fn();
  render(<PlacesMap placeCounts={[pc(7, "Lisbon", 38.7, -9.1, 5)]} onSelectPlace={onSelectPlace} onError={() => {}} />);

  maplibreSpies.markers[0].getElement().click();

  expect(onSelectPlace).toHaveBeenCalledWith(7);
});

it("calls onError when the map fires its own error event", () => {
  const onError = vi.fn();
  render(<PlacesMap placeCounts={[]} onSelectPlace={() => {}} onError={onError} />);

  maplibreSpies.maps[0].emit("error");

  expect(onError).toHaveBeenCalledTimes(1);
});

it("removes the map on unmount", () => {
  const { unmount } = render(<PlacesMap placeCounts={[]} onSelectPlace={() => {}} onError={() => {}} />);

  unmount();

  expect(maplibreSpies.maps[0].removed).toBe(true);
});

it("syncs markers when placeCounts changes, without recreating the map", () => {
  const { rerender } = render(
    <PlacesMap placeCounts={[pc(1, "Lisbon", 38.7, -9.1, 5)]} onSelectPlace={() => {}} onError={() => {}} />,
  );
  expect(maplibreSpies.markers).toHaveLength(1);

  rerender(
    <PlacesMap
      placeCounts={[pc(1, "Lisbon", 38.7, -9.1, 5), pc(2, "Porto", 41.1, -8.6, 2)]}
      onSelectPlace={() => {}}
      onError={() => {}}
    />,
  );

  expect(maplibreSpies.maps).toHaveLength(1);
  expect(maplibreSpies.maps[0].markers).toHaveLength(2);
});
