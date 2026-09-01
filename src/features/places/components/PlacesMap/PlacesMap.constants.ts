/**
 * Dark OpenFreeMap style. This host must appear in BOTH the CSP's
 * `connect-src` (style JSON, TileJSON, vector tiles, glyphs — fetched) and
 * `img-src` (raster tiles and sprites — loaded through an image path) in
 * `src-tauri/tauri.conf.json`. With only `connect-src`, the map renders a
 * black canvas with no MapLibre error events at all — the fetches succeed,
 * the image decode is what CSP blocks.
 */
export const PLACES_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
