import { invokeApi } from "./client";

export type PlaceSource = "geocoder" | "manual";

/** A named location — see `dp_core::Place`. */
export type Place = {
  id: number;
  lat: number;
  lon: number;
  name: string;
  admin: string | null;
  country: string;
  source: PlaceSource;
};

/** A `Place` paired with how many media rows currently reference it — see `dp_core::PlaceCount`. */
export type PlaceCount = {
  place: Place;
  count: number;
};

/** A city from the bundled offline geocoder dataset — see `dp_places::City`. */
export type City = {
  name: string;
  admin: string | null;
  country: string;
  lat: number;
  lon: number;
};

/**
 * Starts (or reuses, if one is already running) the global reverse-geocode
 * sweep — see `src-tauri/src/commands/places.rs::start_geocode`. Unlike a
 * scan/organize job, this isn't scoped to a drive: at most one runs at a
 * time across the whole app.
 */
export const startGeocode = () => invokeApi<string>("start_geocode");

/** Every place with at least one media row pointing at it — see `dp_catalog::Catalog::list_place_counts`. */
export const listPlaceCounts = () => invokeApi<PlaceCount[]>("list_place_counts");

/**
 * Case/diacritic-insensitive prefix search over the bundled city dataset,
 * for the manual place-override picker. An empty `query` resolves to an
 * empty list rather than rejecting.
 */
export const searchCities = (query: string) => invokeApi<City[]>("search_cities", { query });

/**
 * Sets (`city` given) or clears (`city` is `null`) the place assigned to
 * every id in `mediaIds` — the user's manual override, which the
 * reverse-geocode job then leaves alone forever.
 */
export const setMediaPlace = (mediaIds: number[], city: City | null) =>
  invokeApi<void>("set_media_place", { mediaIds, city });
