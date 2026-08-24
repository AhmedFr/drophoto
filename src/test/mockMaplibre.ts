type Listener = (...args: unknown[]) => void;

/** Minimal stand-in for `maplibregl.Marker` — records `setLngLat`/`addTo` calls instead of touching real DOM/WebGL. */
export class FakeMarker {
  element: HTMLElement;
  lngLat: [number, number] | null = null;
  map: FakeMap | null = null;

  constructor(options: { element?: HTMLElement } = {}) {
    this.element = options.element ?? document.createElement("div");
  }

  setLngLat(lngLat: [number, number]) {
    this.lngLat = lngLat;
    return this;
  }

  addTo(map: FakeMap) {
    this.map = map;
    map.markers.push(this);
    return this;
  }

  remove() {
    if (this.map) this.map.markers = this.map.markers.filter((m) => m !== this);
    this.map = null;
    return this;
  }

  getElement() {
    return this.element;
  }
}

/** Minimal stand-in for `maplibregl.Map` — records constructor options and lets tests fire `error`/other events by calling `emit`. */
export class FakeMap {
  options: Record<string, unknown>;
  markers: FakeMarker[] = [];
  removed = false;
  #listeners: Record<string, Listener[]> = {};

  constructor(options: Record<string, unknown>) {
    this.options = options;
  }

  on(event: string, cb: Listener) {
    (this.#listeners[event] ??= []).push(cb);
    return this;
  }

  off(event: string, cb: Listener) {
    this.#listeners[event] = (this.#listeners[event] ?? []).filter((l) => l !== cb);
    return this;
  }

  remove() {
    this.removed = true;
  }

  /** Test-only helper: invokes every listener registered for `event`. */
  emit(event: string, ...args: unknown[]) {
    for (const cb of this.#listeners[event] ?? []) cb(...args);
  }
}

export type MaplibreSpies = { maps: FakeMap[]; markers: FakeMarker[] };

/**
 * Factory for a `maplibre-gl` mock. `maplibre-gl` only has named exports
 * (`Map`, `Marker`, …) — no default export — so the mocked module mirrors
 * that shape.
 *
 * `vi.mock` must be called literally at the top level of the test file
 * that needs it (see `mockVirtualizer.ts` for the same note). Usage:
 *
 * ```ts
 * import { maplibreMockFactory, type MaplibreSpies } from "@/test/mockMaplibre";
 * const maplibreSpies = vi.hoisted<MaplibreSpies>(() => ({ maps: [], markers: [] }));
 * vi.mock("maplibre-gl", () => maplibreMockFactory(maplibreSpies));
 * ```
 */
export function maplibreMockFactory(spies: MaplibreSpies) {
  class Map extends FakeMap {
    constructor(options: Record<string, unknown>) {
      super(options);
      spies.maps.push(this);
    }
  }
  class Marker extends FakeMarker {
    constructor(options: { element?: HTMLElement } = {}) {
      super(options);
      spies.markers.push(this);
    }
  }
  return { Map, Marker };
}

/** Convenience for tests that don't need to assert on spy contents directly (e.g. just rendering `PlacesPage`). */
export function freshMaplibreSpies(): MaplibreSpies {
  return { maps: [], markers: [] };
}
