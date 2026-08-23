# drophoto — Design Spec

Date: 2026-08-22 · Status: approved for planning

## 1. Purpose

**A cloud-photo-library experience without the subscription and without centralising the files.** Photos stay spread across the user's own drives (external SSDs/HDDs, card ingests), yet browsing, categorising and finding them is as easy and intuitive as iCloud/Google Photos: one unified library, always available, regardless of which drive is plugged in.

Three pillars, in priority order:
1. **Unified offline catalog** — every file on every registered drive is indexed once (hash, metadata, thumbnails). The whole library is browsable with zero drives attached; the app tells you which drive holds the original and prompts to plug it in for full-res/export.
2. **Proper storage** — files are never copied or centralised: each drive is organised *in place* (renamed and filed into a date-based folder structure), duplicates detected across all drives. Later: move photos between drives while keeping the same structure and tags.
3. **Navigation** — gallery by time, filters, tags, places (map), camera, full-text search; later faces.

Design source: Claude Design project `e091e781-9f05-4811-8087-8d7c22805b23` (screens: Sidebar, dashboard, drive, gallery, organize, search, tags, settings). Visual language: flat dark UI, `#0a0a0a` bg / `#f4f4f2` fg, Outfit (UI) + JetBrains Mono (data), square corners, 1px borders.

Audience: single user, macOS only for v1. No signing/updater.

## 2. Guiding principles

1. **Use existing libraries for anything "sweaty"** (decoding, metadata, hashing, geocoding). Never write a decoder.
2. **Plugin-style architecture**: every capability sits behind a trait/interface with a registry; implementations are hot-swappable without touching consumers.
3. Organising **never loses data**: same-volume moves are atomic renames; any copy is blake3-verified before the original is removed; every move is logged old→new. No copies are kept, no trash folder.
4. Per-item failures never abort a job.
5. Single-responsibility files; component folder convention (see §9).
6. **Always shippable.** Every phase — and every plan task within it — ends with a runnable app that does something real end-to-end (vertical slices), never a pile of scaffolding waiting on a later phase. Phase 0 already ends with the app launching, showing the shell, and listing mounted volumes.

## 3. Stack

| Layer | Choice |
|---|---|
| Shell | Tauri 2 (macOS) |
| Core | Rust (stable), tokio, `thiserror`, `tracing` |
| DB | SQLite via `sqlx` (migrations, compile-time checked queries), FTS5 |
| Frontend | React 19 + TypeScript, Vite, pnpm |
| UI kit | **shadcn/ui** (Radix primitives + Tailwind 4) with design tokens from the design; **mapcn** (shadcn-style MapLibre components) for maps |
| Data/UI state | TanStack Router, TanStack Query (wraps Tauri `invoke`), Zustand for ephemeral UI state |
| Grid | `@tanstack/react-virtual` (virtualized masonry) |
| Tests | Rust `cargo test`; Vitest + Testing Library; Storybook 8; Playwright (few smoke e2e via tauri-driver, later) |

Sidecars bundled with the app (Tauri `externalBin`): **exiftool**, **ffmpeg**, **ffprobe**. macOS `sips` used from PATH.

## 4. Plugin architecture

### 4.1 Rust core — capability traits

Each lives in its own crate under `crates/`, with implementations in separate crates/modules. A `Registry` (built at startup from `settings`) resolves which implementation serves each capability. Consumers depend only on the trait (`Arc<dyn Trait>`).

| Trait | Responsibility | v1 impl | Alternative impls (future) |
|---|---|---|---|
| `MetadataProvider` | `read(path) -> MediaMetadata` | `ExiftoolProvider` (sidecar, `-stay_open` batch) | `KamadakExifProvider` (pure Rust, JPG-only fast path) |
| `ThumbnailProvider` | `supports(ext)`, `render(path, size) -> RgbImage` | chain: `ImageCrateThumb` (JPG/PNG/TIFF/WebP), `ExiftoolPreviewThumb` (RAW embedded preview), `SipsThumb` (HEIC), `FfmpegThumb` (video) | `LibheifThumb`, `LibrawThumb` |
| `Hasher` | `hash(path) -> Digest` | `Blake3Hasher` | `Xxh3Hasher` |
| `Geocoder` | `reverse(lat, lon) -> Place` | `OfflineGeocoder` (`reverse_geocoder` crate) | online providers |
| `VolumeProvider` | `list() -> Vec<Volume>`, `watch()` | `SysinfoVolumes` | |
| `Catalog` | repository API over the DB | `SqliteCatalog` | |
| `MoveStrategy` | plan + execute one move item | `RenameStrategy` (same volume, atomic) with `CopyVerifyDeleteStrategy` fallback | `CloneStrategy` (APFS clonefile) |
| `NamingTemplate` | render folder/file names from metadata | `HandlebarsTemplate` | |

A `ThumbnailProvider` chain picks the first impl whose `supports(ext)` is true; ordering is config.

Jobs (`scan`, `organize`, `rehash`) implement a `Job` trait (`run(ctx, progress_tx)`, cancellable, resumable) and run on a `JobRunner`; progress is emitted as Tauri events `job:{id}:progress`.

### 4.2 Frontend — feature modules

`src/features/<name>/` is a self-contained module exposing a `FeatureModule` object: `{ id, routes, sidebarEntry?, commands?, settingsPanel? }`. `src/app/registry.ts` assembles enabled modules into the router and sidebar. Features talk to Rust only through `src/lib/api/<capability>.ts` clients (typed wrappers over `invoke`), never raw `invoke` in components.

v1 modules: `dashboard`, `drives`, `gallery`, `organize`, `tags`, `search`, `places` (map via mapcn), `settings`.

Shared: `src/components/ui/*` (shadcn, generated), `src/components/<Domain>/*` (app components), `src/lib/*` (api clients, formatters, hooks).

## 5. Media pipeline

| Need | Library |
|---|---|
| Metadata, all formats | exiftool `-json -n -stay_open` |
| Thumb JPG/PNG/TIFF/WebP | `image` + `fast_image_resize` |
| Thumb RAW | exiftool `-PreviewImage -b` (fallbacks `-JpgFromRaw`, `-ThumbnailImage`) → `image` |
| Thumb HEIC/HEIF | `sips -s format jpeg` → `image` |
| Video thumb + duration | ffmpeg (`-ss 1 -frames:v 1`), ffprobe |
| Hash | `blake3` |
| Volumes | `sysinfo` |
| Reverse geocode | `reverse_geocoder` (offline GeoNames) |
| Templates | `handlebars` |

Thumbnails: WebP at `~/Library/Application Support/drophoto/thumbs/<hash>/{400,2000}.webp`. Keyed by content hash → shared across duplicates. **The catalog + thumbnails are the product**: the 2000px lightbox preview is generated at index time so the library is fully browsable with every drive unplugged. Originals are only needed for full-res view, export, or re-ingest.

### 5.0 Scan sources and the safety deny-list
A drive is never scanned whole by default. Each drive has **sources** (folders) chosen by the user from an auto-detected candidate list: a shallow, hash-free detection pass (depth ≤ 4) counts media per folder and ranks them; external volumes propose their root when it is photo-dominant; the boot volume proposes `~/Pictures`, `~/Desktop`, `~/Downloads` and any folder with ≥ 20 media files. The user confirms; "Add folder…" is always available.

**Deny-list (hard, not overridable in v1):** `/System`, `/Library`, `/Applications`, `/usr`, `/bin`, `/sbin`, `/private`, `/opt`, `/cores`, `~/Library`, any `*.app`, `*.photoslibrary`, `*.aplibrary`, `*.lrcat`/`*.lrdata`, `node_modules`, `.git`, hidden dirs, `$RECYCLE.BIN`, `System Volume Information`, `.Trashes`, `.Spotlight-V100`, `.fseventsd`, `Caches`. Files are also rejected when they look like stubs (< 8 KB with an image extension that fails to decode). Nothing under the deny-list is ever indexed, and organize only ever touches rows that belong to a confirmed source — the catalog stores `media.source_id`.

**Undo:** every organize job is revertible: `revert_organize(job_id)` moves each `moved` item back (`new → old`) with the same no-replace strategy and logs the revert as its own job. The Done screen and the Dashboard expose "Revert".

### 5.1 Drive presence
`VolumeProvider::watch()` updates `drives.mount_path` / `last_seen_at` live. Every `media` row resolves to `online` / `offline` (drive not mounted) / `missing` (drive mounted, file gone → `missing_at`). UI shows the holding drive name everywhere (grid hover, lightbox "Drive" row) and an "Insert **Kodachrome** to view original" affordance when offline.

## 6. Data model (SQLite)

```
drives        id, name, volume_uuid, mount_path, role (legacy, unused), capacity, free, last_seen_at
media         id, drive_id, rel_path, hash, size, kind(photo|video), ext, width, height, duration_ms,
              taken_at, camera, lens, aperture, shutter, iso, focal_mm, lat, lon, place_id, created_at, missing_at
places        id, lat, lon, name, admin, country, source(geocoder|manual)
tags          id, name            media_tags  media_id, tag_id
organize_rules drive_id (PK), root, folder_tpl, file_tpl, keep_pairs
organize_jobs  id, drive_id, status(running|done|cancelled|failed), planned, moved, skipped, failed, started_at, finished_at
organize_items id, job_id, media_id, old_rel_path, new_rel_path, status(planned|moved|skipped_dup|skipped_collision|failed), error
media          + organized_at
scan_errors   id, drive_id, path, code, message, at
settings      key, value(json)
media_fts     FTS5(filename, tags, place, camera)   -- kept in sync by triggers
```

## 7. Organize workflow (in place)

1. Pick one or more registered, online drives (Detect step). Counts come from the catalog: media rows with `organized_at IS NULL`. Drives never scanned offer "Scan now".
2. Each drive has an organize rule (defaults): root `archive`, folder template `{{yyyy}}/Q{{q}}` (preset `{{yyyy}}/{{yyyy}}-{{mm}}-{{dd}}`), file template `{{yyyy}}-{{mm}}-{{dd}}_{{stem}}` (tags segment added in Phase 4), keep RAW+JPEG pairs (same stem → same new stem). Date from `taken_at` → file mtime.
3. **Plan** (nothing moves): for every unorganized row compute `new_rel_path`; duplicates (hash already organized anywhere) → `skipped_dup`; name collisions → `_1`, `_2` suffix; preview grouped by destination folder.
4. **Execute** (`OrganizeJob`): `create_dir_all` + `fs::rename` on the same volume; if the OS reports cross-device, copy → blake3 verify → delete. Update `media.rel_path`, set `organized_at`, log the item. Cancel leaves completed moves in place.
5. Files the catalog doesn't know are never touched. Later phases: move between drives keeping structure + tags.

## 8. Screens → phases

| Phase | Scope |
|---|---|
| 0 Scaffold | Tauri+React+Tailwind+shadcn, tokens, Sidebar, app shell, empty routes, registry, Storybook, CI |
| 1 Drives & scan | Volume list, register/name drive, scan job, metadata + 400/2000px thumbs, progress, drive presence tracking. **Starts with a thumbnail spike on the user's real formats.** |
| 2 Gallery & lightbox | Virtualized masonry by month, type chips, sort, density, lightbox + EXIF panel, ←/→/Esc, video badge. Works fully offline from thumbs; online/offline drive indicator; "insert drive" prompt for originals |
| 3.5 Sources & safety | Per-drive sources with auto-detect + confirm, deny-list, stub rejection, walk-phase progress (dot loader + step text), gallery placeholder for rows without thumbs, organize revert |
| 3 Organize | Organize wizard: Detect (drives + unorganized counts) → Organize (rule editor, full plan preview, execute, done screen); job log; Dashboard: recent jobs, drive capacity, totals; SQLite pool 4 + busy_timeout |
| 4 Tags, places, search | Bulk tag from selection, offline geocode + manual override, Places map (mapcn), FTS search screen |
| 5 Settings & polish | Sidecar health check, cache location, templates defaults, rescan/rehash, missing-file detection |

Later: faces, dedupe/consolidation tooling across drives, export/"bring originals here", APFS clone strategy, cross-platform, auto-update.

## 9. Conventions

- Component folder: `index.ts`, `Name.tsx`, `Name.types.ts`, optional `Name.constants.ts`, `Name.test.tsx`, `Name.stories.tsx`. Keep files short; split logic into hooks/utils.
- Rust: one crate per capability trait + impl crates; `apps/desktop/src-tauri` only wires commands.
- Errors cross the bridge as `{ code, message, path? }`.
- Git flow & CI: see `.claude/skills/git-workflow`. Coverage policy: see `.claude/skills/test-coverage`.

## 10. Testing

- Rust unit tests for templates, naming, planner, hash verify; integration tests run real sidecars over `fixtures/` (JPG, RAF, CR3, ARW, HEIC, PNG, MP4, MOV — small files).
- Frontend: Vitest + Testing Library per component; Tauri API mocked with `@tauri-apps/api/mocks`; Storybook for shadcn-derived components.
- CI (GitHub Actions, macOS runner): lint, typecheck, `cargo test`, `vitest --coverage`, build.
