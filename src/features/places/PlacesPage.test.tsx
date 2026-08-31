import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { it, expect, vi } from "vitest";
import type { MediaItem } from "@/lib/api/media";
import type { PlaceCount } from "@/lib/api/places";
import { maplibreMockFactory, type MaplibreSpies } from "@/test/mockMaplibre";
import { virtualizerMockFactory } from "@/test/mockVirtualizer";
import { renderWithRouter } from "@/test/renderWithRouter";
import { PlacesPage } from "./PlacesPage";

const maplibreSpies = vi.hoisted<MaplibreSpies>(() => ({ maps: [], markers: [] }));
vi.mock("maplibre-gl", () => maplibreMockFactory(maplibreSpies));

vi.mock("@tanstack/react-virtual", () => virtualizerMockFactory());

vi.mock("@tauri-apps/api/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/core")>();
  return { ...actual, convertFileSrc: (path: string) => `asset://mock/${path}` };
});

class ResizeObserverStub {
  #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }

  observe() {
    this.#callback([{ contentRect: { width: 1000 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }

  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  maplibreSpies.maps.length = 0;
  maplibreSpies.markers.length = 0;
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("navigator", { ...navigator, onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithRouter(
    <QueryClientProvider client={queryClient}>
      <PlacesPage />
    </QueryClientProvider>,
  );
  return queryClient;
}

function pc(id: number, name: string, count = 1): PlaceCount {
  return {
    place: { id, lat: 38.7, lon: -9.1, name, admin: null, country: "Portugal", source: "geocoder" },
    count,
  };
}

function item(id: number, overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    row: {
      id,
      drive_id: 1,
      rel_path: `photos/${id}.jpg`,
      hash: `hash${id}`,
      size: 1234,
      kind: "photo",
      ext: "jpg",
      width: 100,
      height: 200,
      duration_ms: null,
      taken_at: "2024-06-15T12:00:00Z",
      camera: null,
      lens: null,
      aperture: null,
      shutter: null,
      iso: null,
      focal_mm: null,
      lat: 38.7,
      lon: -9.1,
      missing_at: null,
      organized_at: null,
      source_id: null,
      place_id: 1,
      mtime: null,
    },
    thumb_path: `/tmp/thumbs/hash${id}/400.webp`,
    preview_path: `/tmp/thumbs/hash${id}/2000.webp`,
    drive_name: "Kodachrome",
    online: true,
    original_path: null,
    has_thumb: true,
    ...overrides,
  };
}

it("renders the Places header", async () => {
  mockIPC((cmd) => (cmd === "list_place_counts" ? [] : undefined));
  renderPage();
  expect(await screen.findByRole("heading")).toHaveTextContent("PLACES");
});

it("shows the empty state when there are no places, mentioning both the GEOCODE NOW and PLACE buttons", async () => {
  mockIPC((cmd) => (cmd === "list_place_counts" ? [] : undefined));
  renderPage();
  const empty = await screen.findByText(/NO PLACES YET/);
  expect(empty).toHaveTextContent(/GEOCODE NOW/);
  expect(empty).toHaveTextContent(/PLACE/);
});

it("GEOCODE NOW fires start_geocode", async () => {
  let called = false;
  mockIPC((cmd) => {
    if (cmd === "list_place_counts") return [];
    if (cmd === "start_geocode") {
      called = true;
      return "job-1";
    }
    return undefined;
  });
  const user = userEvent.setup();
  renderPage();

  await user.click(await screen.findByRole("button", { name: /geocode now/i }));

  await waitFor(() => expect(called).toBe(true));
});

it("creates one map marker per place from list_place_counts, while online", async () => {
  mockIPC((cmd) => (cmd === "list_place_counts" ? [pc(1, "Lisbon", 5), pc(2, "Porto", 2)] : undefined));
  renderPage();

  await waitFor(() => expect(maplibreSpies.markers).toHaveLength(2));
  expect(screen.queryByTestId("place-list")).not.toBeInTheDocument();
});

// I1: GeoNames (place data) and OpenFreeMap/OpenStreetMap (map tiles) both
// require attribution wherever the data they provide is shown — asserted
// in both the map view (online) and the list fallback (offline) since the
// footer must render regardless of which one is active.
it("credits GeoNames and OpenFreeMap/OpenStreetMap in the map view", async () => {
  mockIPC((cmd) => (cmd === "list_place_counts" ? [pc(1, "Lisbon", 5)] : undefined));
  renderPage();

  await waitFor(() => expect(maplibreSpies.maps).toHaveLength(1));
  expect(screen.getByText(/GEONAMES/i)).toBeInTheDocument();
  expect(screen.getByText(/OPENFREEMAP/i)).toBeInTheDocument();
  expect(screen.getByText(/OPENSTREETMAP/i)).toBeInTheDocument();
});

it("credits GeoNames and OpenFreeMap/OpenStreetMap in the offline list view", async () => {
  vi.stubGlobal("navigator", { ...navigator, onLine: false });
  mockIPC((cmd) => (cmd === "list_place_counts" ? [pc(1, "Lisbon", 5)] : undefined));
  renderPage();

  await screen.findByTestId("place-list");
  expect(screen.getByText(/GEONAMES/i)).toBeInTheDocument();
  expect(screen.getByText(/OPENFREEMAP/i)).toBeInTheDocument();
});

it("falls back to PlaceList when navigator.onLine is false at mount", async () => {
  vi.stubGlobal("navigator", { ...navigator, onLine: false });
  mockIPC((cmd) => (cmd === "list_place_counts" ? [pc(1, "Lisbon", 5)] : undefined));
  renderPage();

  expect(await screen.findByTestId("place-list")).toBeInTheDocument();
  expect(screen.getByText("Lisbon")).toBeInTheDocument();
  expect(maplibreSpies.maps).toHaveLength(0);
});

it("falls back to PlaceList when the map fires an error event", async () => {
  mockIPC((cmd) => (cmd === "list_place_counts" ? [pc(1, "Lisbon", 5)] : undefined));
  renderPage();

  await waitFor(() => expect(maplibreSpies.maps).toHaveLength(1));
  maplibreSpies.maps[0].emit("error");

  expect(await screen.findByTestId("place-list")).toBeInTheDocument();
});

it("clicking a marker selects the place and shows its media grid", async () => {
  mockIPC((cmd, args) => {
    if (cmd === "list_place_counts") return [pc(1, "Lisbon", 1)];
    if (cmd === "query_media") {
      const { query } = args as { query: { place_id: number | null } };
      return query.place_id === 1 ? [item(1)] : [];
    }
    return undefined;
  });
  renderPage();

  await waitFor(() => expect(maplibreSpies.markers).toHaveLength(1));
  fireEvent.click(maplibreSpies.markers[0].getElement());

  expect(await screen.findAllByRole("img")).toHaveLength(1);
});

it("clicking a list row selects the place and shows its media grid, and opens the lightbox on a tile click", async () => {
  vi.stubGlobal("navigator", { ...navigator, onLine: false });
  mockIPC((cmd, args) => {
    if (cmd === "list_place_counts") return [pc(1, "Lisbon", 1)];
    if (cmd === "query_media") {
      const { query } = args as { query: { place_id: number | null } };
      return query.place_id === 1 ? [item(1)] : [];
    }
    return undefined;
  });
  const user = userEvent.setup();
  renderPage();

  fireEvent.click(await screen.findByText("Lisbon"));

  const tile = await screen.findByRole("button", { name: /photos\// });
  await user.click(tile);

  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});
