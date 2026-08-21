# drophoto — Design Spec

Date: 2026-08-22 · Status: approved for planning

## 1. Purpose

A personal macOS desktop app for photographers: **ingest** media from cards/drives into named archive drives (copy + verify + organize by date), then **browse** the catalog (gallery, lightbox with full EXIF, tags, places, search).

Design source: Claude Design project `e091e781-9f05-4811-8087-8d7c22805b23` (screens: Sidebar, dashboard, drive, gallery, organize, search, tags, settings). Visual language: flat dark UI, `#0a0a0a` bg / `#f4f4f2` fg, Outfit (UI) + JetBrains Mono (data), square corners, 1px borders.

Audience: single user, macOS only for v1. No signing/updater.

## 2. Guiding principles

1. **Use existing libraries for anything "sweaty"** (decoding, metadata, hashing, geocoding). Never write a decoder.
2. **Plugin-style architecture**: every capability sits behind a trait/interface with a registry; implementations are hot-swappable without touching consumers.
3. Ingest **never deletes or modifies the source**. Copy, verify, then record.
4. Per-item failures never abort a job.
5. Single-responsibility files; component folder convention (see §9).

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
| `IngestStrategy` | plan + execute one copy item | `CopyVerifyStrategy` | `CloneStrategy` (APFS clonefile), `MoveStrategy` |
| `NamingTemplate` | render folder/file names from metadata | `HandlebarsTemplate` | |

A `ThumbnailProvider` chain picks the first impl whose `supports(ext)` is true; ordering is config.

Jobs (`scan`, `ingest`, `rehash`) implement a `Job` trait (`run(ctx, progress_tx)`, cancellable, resumable) and run on a `JobRunner`; progress is emitted as Tauri events `job:{id}:progress`.

### 4.2 Frontend — feature modules

`src/features/<name>/` is a self-contained module exposing a `FeatureModule` object: `{ id, routes, sidebarEntry?, commands?, settingsPanel? }`. `src/app/registry.ts` assembles enabled modules into the router and sidebar. Features talk to Rust only through `src/lib/api/<capability>.ts` clients (typed wrappers over `invoke`), never raw `invoke` in components.

v1 modules: `dashboard`, `drives`, `gallery`, `ingest` (the "organize" screen), `tags`, `search`, `places` (map via mapcn), `settings`.

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

Thumbnails: WebP at `~/Library/Application Support/drophoto/thumbs/<hash>/{400,2000}.webp`. Keyed by content hash → shared across duplicates, catalog browsable with drive unplugged.

## 6. Data model (SQLite)

```
drives        id, name, volume_uuid, mount_path, role(source|archive), capacity, free, last_seen_at
media         id, drive_id, rel_path, hash, size, kind(photo|video), ext, width, height, duration_ms,
              taken_at, camera, lens, aperture, shutter, iso, focal_mm, lat, lon, place_id, created_at, missing_at
places        id, lat, lon, name, admin, country, source(geocoder|manual)
tags          id, name            media_tags  media_id, tag_id
ingest_jobs   id, source_path, dest_drive_id, mirror_drive_id, folder_tpl, file_tpl, status, started_at, finished_at
ingest_items  id, job_id, src_path, dest_path, hash, status(planned|copied|verified|skipped_dup|failed), error
scan_errors   id, drive_id, path, code, message, at
settings      key, value(json)
media_fts     FTS5(filename, tags, place, camera)   -- kept in sync by triggers
```

## 7. Ingest workflow

1. Choose source (volume or folder) + primary archive drive, optional mirror.
2. Templates: folder `{{yyyy}}/{{yyyy}}-{{mm}}-{{dd}}`, file `{{yyyy}}{{mm}}{{dd}}_{{HH}}{{MM}}{{SS}}_{{orig}}`; date from `DateTimeOriginal` → `CreateDate` → file mtime.
3. **Dry run** → plan of items; hash-duplicates already in catalog marked `skipped_dup` (toggle to re-copy). Name collisions get `_1`, `_2` suffix.
4. Execute: copy → hash source and destination → compare → `verified` → insert `media` → thumbnail → mirror copy (same verify).
5. Source untouched. Drive disappears → job pauses (`DriveMissing`), resumable.

## 8. Screens → phases

| Phase | Scope |
|---|---|
| 0 Scaffold | Tauri+React+Tailwind+shadcn, tokens, Sidebar, app shell, empty routes, registry, Storybook, CI |
| 1 Drives & scan | Volume list, register/name drive, scan job, metadata + thumbs, progress. **Starts with a thumbnail spike on the user's real formats.** |
| 2 Gallery & lightbox | Virtualized masonry by month, type chips, sort, density, lightbox + EXIF panel, ←/→/Esc, video badge |
| 3 Ingest | Organize screen: source/dest/template editor, dry-run table, execute, job log; Dashboard: recent jobs, drive capacity |
| 4 Tags, places, search | Bulk tag from selection, offline geocode + manual override, Places map (mapcn), FTS search screen |
| 5 Settings & polish | Sidecar health check, cache location, templates defaults, rescan/rehash, missing-file detection |

Later: faces, dedupe tooling, APFS clone strategy, cross-platform, auto-update.

## 9. Conventions

- Component folder: `index.ts`, `Name.tsx`, `Name.types.ts`, optional `Name.constants.ts`, `Name.test.tsx`, `Name.stories.tsx`. Keep files short; split logic into hooks/utils.
- Rust: one crate per capability trait + impl crates; `apps/desktop/src-tauri` only wires commands.
- Errors cross the bridge as `{ code, message, path? }`.
- Git flow & CI: see `.claude/skills/git-workflow`. Coverage policy: see `.claude/skills/test-coverage`.

## 10. Testing

- Rust unit tests for templates, naming, planner, hash verify; integration tests run real sidecars over `fixtures/` (JPG, RAF, CR3, ARW, HEIC, PNG, MP4, MOV — small files).
- Frontend: Vitest + Testing Library per component; Tauri API mocked with `@tauri-apps/api/mocks`; Storybook for shadcn-derived components.
- CI (GitHub Actions, macOS runner): lint, typecheck, `cargo test`, `vitest --coverage`, build.
