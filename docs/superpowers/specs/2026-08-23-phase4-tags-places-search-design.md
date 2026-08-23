# Phase 4: Tags, Search, Places — Design

**Date:** 2026-08-23 · **Parent spec:** `2026-08-22-drophoto-design.md` (§6 data model, §8 phases) · **Status:** approved in conversation 2026-08-23

Three independently mergeable slices, each leaving the app fully usable:
**4a Selection & Tags** (+ XMP sidecars + job-outcome fix) → **4b Search** (FTS5) → **4c Places** (offline geocode + mapcn map).

## 1. Decisions (user-confirmed)

1. **Tags live in the catalog AND in XMP sidecars** (`<file>.xmp`, `XMP-dc:Subject`). Drives stay self-describing; a re-scan re-imports tags; catalog loss loses nothing. No `{{tags}}` file-name segment (supersedes the §7 note — tagging never renames files).
2. **Offline geocoding, online map tiles.** Bundled GeoNames cities dataset (pop ≥ 1000, ~15 MB source, compacted at build) for GPS → nearest city with zero network. Map tiles load from OpenFreeMap when online; offline shows placeholder + place list.
3. **Tagging works offline.** Catalog takes the tag instantly; rows are marked `sidecar_pending`; a sweep writes XMPs when the drive next appears and after every scan.
4. **Three PRs, one spec** (this document).

## 2. Data model (migrations 0005–0007)

```sql
-- 0005 (4a)
CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
CREATE TABLE media_tags (
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (media_id, tag_id)
);
ALTER TABLE media ADD COLUMN sidecar_pending INTEGER NOT NULL DEFAULT 0;

-- 0006 (4b)
CREATE VIRTUAL TABLE media_fts USING fts5(
  stem, tags, place, camera, content='', tokenize='unicode61'
);
-- external-content style, rowid = media.id; synced by catalog code (not SQL
-- triggers: tags/places live in other tables), rebuildable via a command.

-- 0007 (4c)
CREATE TABLE places (
  id INTEGER PRIMARY KEY, lat REAL NOT NULL, lon REAL NOT NULL,
  name TEXT NOT NULL, admin TEXT, country TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('geocoder','manual'))
);
ALTER TABLE media ADD COLUMN place_id INTEGER REFERENCES places(id);
```

## 3. Slice 4a — Selection & Tags

**Gallery multi-select.** Plain click keeps opening the lightbox. ⌘-click toggles selection; shift-click selects a range (anchor = last toggled). Selection lives in the gallery Zustand store (NOT persisted; cleared on route change). When non-empty, a selection bar overlays the gallery footer: `N SELECTED · TAG · PLACE (4c) · CLEAR`.

**TagPanel.** Popover from the selection bar and from the lightbox (single item). Combobox lists existing tags with tri-state checks (all/some/none of selection), free-text creates a tag. Apply calls `tag_media { media_ids, add: [tag names], remove: [tag ids] }` — creates missing tags, updates `media_tags`, marks every touched row `sidecar_pending = 1`, updates FTS (once 4b lands).

**Rust:**
- `dp-catalog`: `tags.rs` — `list_tags`, `tags_for_media(ids)`, `tag_media(ids, add, remove)`, `list_sidecar_pending(drive_id)`, `clear_sidecar_pending(media_id)`.
- `dp-metadata`: `SidecarWriter` trait + exiftool impl — writes/merges `<abs path>.xmp` `XMP-dc:Subject` (whole-list replace with catalog truth; never touches the image file); `read_sidecar_tags(path)` for scan import.
- `dp-jobs`: **`SidecarSyncJob`** (per drive, JobRunner admission kind `"sidecar"`, non-exclusive with scan? — NO: same per-drive one-job rule as everything else). Iterates `list_sidecar_pending`, deny-list-checks each path, writes the sidecar, clears the flag. Triggered: (a) after every scan of that drive, (b) when a drive with pending rows comes online (drive-presence watcher), (c) manually from Drives.
- **Scan import:** during scan, if `<file>.xmp` exists, parse `dc:Subject` and union those tags into the catalog (catalog ∪ sidecar; no deletions).
- **Organize/Revert:** when moving a media file, also move its `.xmp` sidecar (same guards; sidecar move failure = item-level warning recorded on the item, not a job failure; revert moves it back).
- **Job-outcome fix (queued from Phase 3):** `JobEvent::Cancelled` and `JobEvent::Err` carry `{ok, failed, skipped}` tallies so cancelled/offline Done screens show real counts.

**Lightbox** meta panel shows tags (chips) with inline add/remove.

## 4. Slice 4b — Search

- `media_fts` over: file stem, tag names (space-joined), place name+admin+country, camera. Catalog updates rows on media upsert/delete, tag change, place change; `rebuild_fts` command for recovery; unit-tested sync.
- Command `search_media(query, limit)` — FTS `MATCH` with `*` prefix on the last token, ranked `bm25`, returns `MediaItem`s.
- **Search screen** (design's `search` layout): single input (debounced 200 ms), kind chips (photos/videos), results in the existing gallery grid + lightbox, empty-state and no-results states. Fully offline from thumbs.

## 5. Slice 4c — Places

- **`Geocoder` trait** in `dp-core`/`dp-places`; impl backed by a bundled, build-time-compacted GeoNames cities file (name, admin1, country, lat, lon), nearest-neighbour via a small k-d tree loaded lazily.
- **`GeocodeJob`** (per drive or global; admission kind `"geocode"`): for media with `lat/lon` and `place_id IS NULL`, nearest city within 50 km → find-or-create `places` row (`source='geocoder'`) and set `media.place_id`. Runs after scans; manual "Geocode now" on the Places screen. Never overwrites a row whose place has `source='manual'`.
- **Manual override:** from selection bar / lightbox — search bundled cities by name, assign; creates/uses a `source='manual'` place.
- **Places screen:** mapcn (MapLibre GL) with clustered markers built from `places` + per-place media counts; OpenFreeMap vector tiles (online). Clicking a place/cluster opens the gallery grid filtered to that place. Offline: tiles unavailable → dark placeholder panel + the same place list grouped by country (fully functional).

## 6. Error handling & testing

- All errors `DpError`; exiftool/sidecar failures carry the path.
- Sidecar writes are deny-list-guarded like every other file touch.
- Tests: real-FS Rust (sidecar write/merge/import, sidecar move on organize+revert, FTS sync on each mutation path, geocoder nearest-neighbour on known coordinates, pending-sweep on drive-online); TS component tests with mockIPC (selection interactions, TagPanel tri-state, search debounce/results, places list offline state); coverage thresholds unchanged.
- Local gate suite is the merge gate (no GitHub CI).

## 7. Out of scope (unchanged "Later")

Faces, cross-drive moves with tags, dedupe tooling, export, tag hierarchies, map tile caching.
