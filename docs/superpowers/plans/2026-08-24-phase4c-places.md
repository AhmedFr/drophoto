# Phase 4c: Places Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GPS-tagged photos get a human place name with zero network (bundled cities dataset), a Places screen shows them on a map (online tiles) or as a grouped list (offline), and place names join tag/file search.

**Architecture:** New `dp-places` crate: a compact, repo-committed cities dataset (GeoNames-derived) behind a `Geocoder` trait with linear nearest-city lookup (~150k rows, fast enough — no spatial index, YAGNI). A `GeocodeJob` back-fills `media.place_id` after scans; manual override wins permanently. The Places screen uses MapLibre GL with OpenFreeMap's dark style when online and degrades to a country-grouped place list offline. Place names feed the existing `media_fts` via `sync_fts`.

**Tech Stack:** Rust (dp-places, linear geo lookup), maplibre-gl (+ its CSS), OpenFreeMap vector tiles, React 19 + TS.

**Spec:** `docs/superpowers/specs/2026-08-23-phase4-tags-places-search-design.md` (§5)

## Global Constraints

- Same as 4a/4b: no `unwrap`/`expect` in non-test Rust; `DpError`; components never import `@tauri-apps/*`; component folders; TDD real-FS/in-memory catalog + mockIPC; pristine output; coverage holds.
- Local gates are the merge gate (NO GitHub CI): `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm tauri build --debug --no-bundle`.
- Commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Branch `feat/17-places`. Controller pushes.
- Geocoding NEVER overwrites a manual place: a media row whose current `place_id` points at a `source='manual'` place is skipped by `GeocodeJob` forever.
- The map is the ONLY networked surface in the app; everything else must keep working with no network. Tile fetch failure degrades to the offline list, never an error page.

---

### Task 4c.1: Migration 0007 + places catalog module + FTS place text

**Files:**
- Create: `crates/dp-catalog/migrations/0007_places.sql`, `crates/dp-catalog/src/places.rs`
- Modify: `crates/dp-catalog/src/lib.rs` (trait + mod), `crates/dp-catalog/src/fts.rs` (`insert_fts_row` joins the place name/admin/country into the `place` column), `crates/dp-core/src/types.rs` (`Place`, `NewPlace`, `MediaRow.place_id`, `MediaQuery.place_id: Option<i64>`), `crates/dp-catalog/src/query.rs` (place filter), `crates/dp-catalog/src/media.rs` (SELECTs gain `place_id`)
- Test: `crates/dp-catalog/tests/places.rs`; extend `tests/fts.rs`, `tests/query.rs` (or wherever query_media is tested)
- Modify: `dp-jobs` test doubles + `MediaRow` literals

**Interfaces:**
- Produces:

```sql
-- 0007_places.sql
CREATE TABLE places (
    id INTEGER PRIMARY KEY, lat REAL NOT NULL, lon REAL NOT NULL,
    name TEXT NOT NULL, admin TEXT, country TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('geocoder','manual'))
);
ALTER TABLE media ADD COLUMN place_id INTEGER REFERENCES places(id);
```

```rust
// dp-core
pub struct Place { pub id: i64, pub lat: f64, pub lon: f64, pub name: String, pub admin: Option<String>, pub country: String, pub source: PlaceSource }
pub enum PlaceSource { Geocoder, Manual }   // serde lowercase
pub struct NewPlace { /* same minus id */ }
pub struct PlaceCount { pub place: Place, pub count: u64 }   // for the map/list

// Catalog trait
/// Find-or-create by (name, admin, country, source) — geocoder places dedupe.
async fn upsert_place(&self, p: NewPlace) -> DpResult<Place>;
async fn list_place_counts(&self) -> DpResult<Vec<PlaceCount>>;   // only places with ≥1 media
/// Sets place_id on every id + syncs FTS per row (log-only, like tags).
async fn set_media_place(&self, ids: &[i64], place_id: Option<i64>) -> DpResult<()>;
/// Rows with GPS, no place, and NOT manual-skipped — for the geocode job.
async fn list_ungeocoded(&self, limit: u32) -> DpResult<Vec<MediaRow>>;
```

- [ ] Steps: failing tests (upsert_place dedupes geocoder rows by name/admin/country; list_place_counts counts media and skips empty places; set_media_place sets/clears + makes the place searchable via `search_media("lisbon")`; query_media with `place_id` filters; `list_ungeocoded` excludes rows without GPS, with a place, already-manual) → implement → `insert_fts_row` place text = `name + ' ' + admin + ' ' + country` of the joined place (empty when none) → workspace green → commit `feat(catalog): places table, place filter and place-aware search`.

---

### Task 4c.2: dp-places crate — bundled geocoder

**Files:**
- Create: `crates/dp-places/` (Cargo.toml, `src/lib.rs`, `src/geocoder.rs`, `data/cities.tsv.gz` ~2–4 MB committed, `scripts/build-dataset.sh`)
- Modify: workspace `Cargo.toml` members
- Test: `crates/dp-places/tests/geocoder.rs`

**Interfaces:**
- Produces:

```rust
pub struct City { pub name: String, pub admin: Option<String>, pub country: String, pub lat: f64, pub lon: f64 }
pub trait Geocoder: Send + Sync {
    /// Nearest city within `max_km`, or None. Pure CPU, no I/O after load.
    fn reverse(&self, lat: f64, lon: f64, max_km: f64) -> Option<&City>;
    /// Case/diacritic-insensitive prefix search by name, for manual override. Max `limit`.
    fn search(&self, query: &str, limit: usize) -> Vec<&City>;
}
pub struct BundledGeocoder { /* Vec<City>, loaded lazily from the gzipped TSV via include_bytes! + flate2 */ }
impl BundledGeocoder { pub fn load() -> DpResult<Self>; }
```

- Dataset: `scripts/build-dataset.sh` downloads GeoNames `cities1000.zip`, extracts columns `name, admin1 name (via admin1CodesASCII), country code → name, lat, lon`, writes TSV, gzips. Run ONCE by the implementer; the `.gz` artifact is committed (regeneration documented in the script header). If the download is unreachable, fall back to `cities5000` or fail the task loudly — never commit a hand-made subset silently.
- Distance: haversine; linear scan with a cheap `|Δlat| ≤ max_km/111 + slack` pre-filter. `reverse` for Paris (48.8566, 2.3522) → "Paris"; mid-Atlantic (0, -30) with 50 km → None; `search("liss")` finds "Lisbon" (stored as "Lisbon"); diacritics: search("sao") finds "São Paulo".
- [ ] Steps: script + dataset → failing tests → implement → fmt/clippy/workspace tests → commit `feat(places): bundled offline geocoder`.

---

### Task 4c.3: GeocodeJob + commands + TS api

**Files:**
- Create: `crates/dp-jobs/src/geocode.rs`, `src-tauri/src/commands/places.rs`, `src/lib/api/places.ts` (+ tests)
- Modify: `dp-jobs/src/lib.rs`, `src-tauri/src/state.rs` (`geocoder: Arc<dyn Geocoder>` — `BundledGeocoder::load()` at init, plus `start_geocode`), `src-tauri/src/lib.rs`, `src/components/JobEventsBridge` (post-scan trigger, like sidecars)
- Test: `crates/dp-jobs/tests/geocode.rs`; bridge test

**Interfaces:**
- Produces:

```rust
pub struct GeocodeDeps { pub catalog: Arc<dyn Catalog>, pub geocoder: Arc<dyn Geocoder> }
pub struct GeocodeJob { /* new(id, deps) — GLOBAL job, not per drive: admission kind "geocode", drive_id 0 sentinel */ }
// run: loop list_ungeocoded(500) → for each row: reverse(lat, lon, 50.0) →
//   Some(city) → upsert_place(geocoder) + set_media_place([id], Some(place.id)) → ok++
//   None → set nothing; mark handled so the loop terminates (track attempted ids like SidecarSyncJob; a no-city row is `skipped`)
// cancel/panic/tallies like SidecarSyncJob.

#[tauri::command] pub async fn start_geocode(state) -> Result<String, DpError>;
#[tauri::command] pub async fn list_place_counts(state) -> Result<Vec<PlaceCount>, DpError>;
#[tauri::command] pub async fn search_cities(state, query: String) -> Result<Vec<City>, DpError>;   // limit 20
#[tauri::command] pub async fn set_media_place(state, media_ids: Vec<i64>, city: Option<City>) -> Result<(), DpError>;
// city Some → upsert_place(source=manual) + assign; None → clear place_id
```

```ts
// src/lib/api/places.ts
startGeocode(): Promise<string>; listPlaceCounts(): Promise<PlaceCount[]>;
searchCities(query: string): Promise<City[]>; setMediaPlace(mediaIds: number[], city: City | null): Promise<void>;
```

- Bridge: on scan `finished` also fire `startGeocode().catch(() => {})` (alongside the sidecar sweep; a geocode job with nothing to do finishes instantly). `jobsStore` label: `geocode-` → "Geocode"; `onTerminalEvent` treats `geocode-` like `sidecar-`: invalidates only `["places"]`, `["search"]`, `["media"]`; silent unless `failed > 0`.
- [ ] Steps: failing job tests (assigns nearest city ≤50 km; >50 km skipped; manual place never overwritten; drains with attempted-set; cancel) → command tests where pure → bridge tests (scan finish triggers geocode too; geocode finish triggers nothing) → gates → commit `feat(places): geocode job, manual override commands`.

---

### Task 4c.4: Places screen (map + offline list) + PLACE in selection/lightbox

**Files:**
- Create: `src/features/places/{index.ts,module.ts,PlacesPage.tsx}` (mirror `src/features/search/module.ts` registration; add to `src/app/features.ts`), `src/features/places/components/{PlacesMap,PlaceList,PlacePanel}/…`, `src/features/places/hooks/usePlaces.ts`
- Modify: `src-tauri/tauri.conf.json` CSP (append `; connect-src 'self' https://tiles.openfreemap.org; worker-src 'self' blob:` and extend `img-src` with `blob: https://tiles.openfreemap.org` — MapLibre needs blob workers and tile fetches), `package.json` (`pnpm add maplibre-gl`), `src/features/gallery` (SelectionBar gains `PLACE` button → PlacePanel; MetaPanel place row with the place name + change/clear)
- Test: alongside; MapLibre is mocked in tests (`vi.mock("maplibre-gl")`) — assert markers/sources fed with `list_place_counts` data, not real rendering

**Interfaces:**
- `usePlaces()`: `["places"]` query → `PlaceCount[]`; `online` via `navigator.onLine` + map `error` event fallback.
- `PlacesPage`: map fills the pane (dark OpenFreeMap style `https://tiles.openfreemap.org/styles/dark`), one marker per place with a count badge, click → side panel listing that place's photos (gallery grid via `query_media` + `place_id` filter — add `placeId` to the TS `MediaQuery` type and `listMediaQuery` client) with the lightbox. Offline (or map failed): `PlaceList` — places grouped by country, same click-through. Empty state: "NO PLACES YET — photos with GPS get placed automatically after a scan; or select photos and press PLACE."
- `PlacePanel` (from SelectionBar `PLACE` and MetaPanel): input → `searchCities` (debounced 200 ms) → pick a city → `setMediaPlace(ids, city)`; `CLEAR PLACE` → `setMediaPlace(ids, null)`; invalidates `["places"]`, `["media"]`, `["search"]`.
- [ ] Steps: failing usePlaces/PlacePanel/PlaceList tests → PlacesPage with mocked maplibre (markers from data; offline fallback renders list) → SelectionBar/MetaPanel wiring tests → implement → gates incl. `tauri build` (CSP change smoke) → commit `feat(places): places screen with map and manual override`.

---

### Task 4c.5: Finalize

- [ ] Full gates; push; PR `Closes #17` titled `feat: places — offline geocoding and map (Phase 4c)`; whole-branch review (opus) + one fix wave; merge; memory + spec check-off.
