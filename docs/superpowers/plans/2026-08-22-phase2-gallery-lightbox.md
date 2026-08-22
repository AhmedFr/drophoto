# drophoto Phase 2 — Gallery & Lightbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fast, filterable, virtualized gallery grouped by month with a full lightbox (2000px preview, EXIF panel, keyboard nav, Reveal in Finder) that works with every drive unplugged.

**Architecture:** Server-side filtering/sorting/paging via a `MediaQuery` contract on `Catalog` (sqlx, dynamic WHERE). Frontend: `useInfiniteQuery` over `query_media`, a pure `buildLayout` util that turns items into month headers + justified rows, a TanStack-Virtual list over that flat layout, and a `Lightbox` fed by `get_media`. Gallery UI state (filter, sort, density) lives in a persisted Zustand store.

**Tech Stack:** Rust (sqlx 0.8, dp-* crates), Tauri 2 (`tauri-plugin-opener` reveal), React 19 + TS, TanStack Query/Virtual/Router, Zustand 5, shadcn (DropdownMenu, ToggleGroup, Button, Badge, Tooltip), lucide-react, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-22-drophoto-design.md` (§2 principles, §4 plugin architecture, §5.1 drive presence, §8 Phase 2 row, §9 conventions, §10 testing). Phase 2 design decisions (approved in chat 2026-08-22): justified rows (not CSS masonry); lightbox always shows the 2000px preview; ships with spec §8 Phase-1 deferred items: `rel_path` strip_prefix fallback → error, `limit` cap.

**Design deviation (ruling):** gallery state is kept in a persisted Zustand store rather than URL search params — the registry-typed router has no typed search, and persistence across launches is what the user actually gets from "survives navigation". Cost if wrong: no deep-linkable filters (not a Phase-2 need).

## Global Constraints

- macOS only; pnpm only; Rust workspace with `crates/dp-*` capability crates; `src-tauri` wires only.
- Errors cross the bridge as `{ code, message, path? }` (`DpError`); no `unwrap`/`expect` in non-test Rust; CPU/blocking work off the async runtime.
- Frontend: components never import `@tauri-apps/*` directly — only `src/lib/api/*`, `src/lib/media/*`, `src/lib/hooks/*`. Component folder convention: `index.ts`, `Name.tsx`, `Name.types.ts`, optional `Name.constants.ts`, `Name.test.tsx`. Keep files short; split logic into hooks/utils.
- Design tokens/classes already exist: `bg-background`, `bg-surface`, `bg-surface-2`, `border-border`, `border-border-2`, `border-border-3`, `text-muted-foreground`, `text-dim`, `text-faint`, `text-ghost`, `font-mono`, `font-sans`, radius 0. Lightbox colors from the design: overlay `rgba(6,6,6,0.97)`, aside 372px `#0b0b0a`, section labels mono 9px tracking 2.5px `#57574f`.
- Coverage thresholds (enforced): global 80 lines / 75 branches; `src/lib/**` 90; shadcn `src/components/ui/**` excluded. TDD for all logic.
- Always shippable: every task ends with `pnpm tauri dev` launching and the Gallery usable.
- CI gates: `pnpm lint && pnpm typecheck && pnpm test:coverage`, `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `pnpm tauri build --debug --no-bundle`.
- Git: issue → branch `feat/<n>-gallery-lightbox` → conventional commits with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` → PR → CI green → squash-merge. See `.claude/skills/git-workflow`.
- Type-filter vocabulary (exact): chips `ALL | JPG | RAW | HEIF | PNG | VIDEO`; JPG → exts `jpg,jpeg`; RAW → `raf,cr2,cr3,arw,nef,dng,orf,rw2`; HEIF → `heic,heif`; PNG → `png`; VIDEO → kind `video`. Sort vocabulary: `NEWEST` (taken_at desc, nulls last, id desc), `OLDEST` (taken_at asc, nulls last, id asc), `ADDED` (id desc). Density: `Comfortable`=240px, `Compact`=180px, `Dense`=130px target row height.
- Limit cap: `MediaQuery.limit` is clamped to `[1, 2000]` server-side; page size 500 client-side.

---

## File structure (end state)

```
crates/dp-core/src/types.rs           + MediaQuery, MediaSort, MediaItem.preview_path
crates/dp-catalog/src/{lib.rs,media.rs,query.rs}   + query_media, count_media_query, get_media_with_drive
crates/dp-catalog/tests/query.rs
crates/dp-jobs/src/scan.rs            rel_path → Result (strip_prefix failure = ItemError "path")
src-tauri/src/commands/media.rs       query_media, count_media, get_media (list_media removed)
src/lib/api/media.ts(+.test.ts)       MediaQuery, MediaSort, queryMedia, countMedia, getMedia
src/lib/media/typeFilter.ts(+.test.ts)   TypeFilter → {kinds, exts}
src/lib/media/layout.ts(+.test.ts)    buildLayout, LayoutItem
src/lib/media/format.ts(+.test.ts)    formatDuration, formatExposure, formatCoords, formatTakenAt, monthLabel
src/lib/hooks/useKeyboardNav.ts(+.test.ts)
src/features/gallery/store/galleryStore.ts(+.test.ts)        zustand persist: typeFilter, sort, density
src/features/gallery/hooks/useMediaInfinite.ts(+.test.ts)
src/features/gallery/hooks/useMediaCount.ts
src/features/gallery/components/GalleryToolbar/*
src/features/gallery/components/VirtualGrid/*   (VirtualGrid.tsx, MonthHeader.tsx, JustifiedRow.tsx)
src/features/gallery/components/Tile/*
src/features/gallery/components/Lightbox/*      (Lightbox.tsx, MetaPanel.tsx, MetaSection.tsx)
src/features/gallery/GalleryPage.tsx(+.test.tsx)
src/components/ui/{dropdown-menu,toggle-group}.tsx   (shadcn add)
deleted: src/features/gallery/components/ThumbGrid/*, listMedia
```

---

### Task 2.1: `MediaQuery` contract — `query_media` / `count_media_query` / `get_media_with_drive`; rel_path error; commands

**Files:**
- Modify: `crates/dp-core/src/types.rs`, `crates/dp-catalog/src/lib.rs`, `crates/dp-catalog/src/media.rs`
- Create: `crates/dp-catalog/src/query.rs`, `crates/dp-catalog/tests/query.rs`
- Modify: `crates/dp-jobs/src/scan.rs`, `crates/dp-jobs/tests/scan.rs`
- Modify: `src-tauri/src/commands/media.rs`, `src-tauri/src/lib.rs`
- Modify: `src/lib/api/media.ts`, `src/lib/api/media.test.ts`, `src/features/gallery/GalleryPage.tsx`, `src/features/gallery/GalleryPage.test.tsx`

**Interfaces:**
- Produces (Rust, dp-core):
  ```rust
  #[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
  #[serde(rename_all = "snake_case")]
  pub enum MediaSort { #[default] TakenDesc, TakenAsc, AddedDesc }
  #[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
  pub struct MediaQuery { pub kinds: Vec<MediaKind>, pub exts: Vec<String>, pub sort: MediaSort, pub limit: u32, pub offset: u32 }
  impl MediaQuery { pub const MAX_LIMIT: u32 = 2000; pub fn clamped(self) -> Self /* limit in 1..=2000 */ }
  pub struct MediaItem { pub row: MediaRow, pub thumb_path: String, pub preview_path: String, pub drive_name: String, pub online: bool }
  ```
- Produces (Catalog trait additions):
  ```rust
  async fn query_media(&self, q: &MediaQuery) -> DpResult<Vec<(MediaRow, Drive)>>;
  async fn count_media_query(&self, q: &MediaQuery) -> DpResult<u64>;
  async fn get_media_with_drive(&self, id: i64) -> DpResult<(MediaRow, Drive)>;   // NotFound if absent
  ```
  `list_media_with_drive` stays (used by nothing after this task — delete it and its test; keep `list_media`).
- Produces (Tauri commands): `query_media(query: MediaQuery) -> Vec<MediaItem>`, `count_media(query: MediaQuery) -> u64`, `get_media(id: i64) -> MediaItem`. `list_media` removed.
- Produces (TS): `MediaSort = "taken_desc" | "taken_asc" | "added_desc"`, `MediaQuery = { kinds: MediaKind[]; exts: string[]; sort: MediaSort; limit: number; offset: number }`, `queryMedia(q)`, `countMedia(q)`, `getMedia(id)`, `MediaItem.preview_path`.

- [ ] **Step 1: dp-core types** — add `MediaSort`, `MediaQuery` (+`clamped()`), `preview_path` on `MediaItem`. Unit test in `types.rs`: `MediaQuery { limit: 0, ..Default::default() }.clamped().limit == 1` and `limit: 9999 → 2000`. Run `cargo test -p dp-core` → PASS.

- [ ] **Step 2: failing catalog tests** — `crates/dp-catalog/tests/query.rs`:
```rust
use chrono::{TimeZone, Utc};
use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, MediaKind, MediaQuery, MediaSort, NewDrive, NewMedia};

async fn seed() -> (SqliteCatalog, i64) {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let d = c.register_drive(NewDrive { name: "A".into(), mount_path: "/Volumes/A".into(), role: DriveRole::Archive, capacity: 1, free: 1 }).await.unwrap();
    let mk = |rel: &str, kind: MediaKind, ext: &str, day: Option<u32>| NewMedia {
        drive_id: d.id, rel_path: rel.into(), hash: rel.into(), size: 1, kind, ext: ext.into(),
        width: Some(4), height: Some(3), duration_ms: None,
        taken_at: day.map(|dd| Utc.with_ymd_and_hms(2025, 9, dd, 12, 0, 0).unwrap()),
        camera: None, lens: None, aperture: None, shutter: None, iso: None, focal_mm: None, lat: None, lon: None,
    };
    c.upsert_media(mk("a.jpg", MediaKind::Photo, "jpg", Some(1))).await.unwrap();
    c.upsert_media(mk("b.raf", MediaKind::Photo, "raf", Some(5))).await.unwrap();
    c.upsert_media(mk("c.mp4", MediaKind::Video, "mp4", Some(3))).await.unwrap();
    c.upsert_media(mk("d.heic", MediaKind::Photo, "heic", None)).await.unwrap();
    (c, d.id)
}
fn q() -> MediaQuery { MediaQuery { limit: 100, ..Default::default() } }

#[tokio::test] async fn default_query_returns_all_newest_first_undated_last() {
    let (c, _) = seed().await;
    let rows: Vec<String> = c.query_media(&q()).await.unwrap().into_iter().map(|(m, _)| m.rel_path).collect();
    assert_eq!(rows, ["b.raf", "c.mp4", "a.jpg", "d.heic"]);
}
#[tokio::test] async fn filter_by_exts() {
    let (c, _) = seed().await;
    let r = c.query_media(&MediaQuery { exts: vec!["jpg".into(), "jpeg".into()], ..q() }).await.unwrap();
    assert_eq!(r.len(), 1); assert_eq!(r[0].0.rel_path, "a.jpg");
}
#[tokio::test] async fn filter_by_kind_video() {
    let (c, _) = seed().await;
    let r = c.query_media(&MediaQuery { kinds: vec![MediaKind::Video], ..q() }).await.unwrap();
    assert_eq!(r.len(), 1); assert_eq!(r[0].0.rel_path, "c.mp4");
}
#[tokio::test] async fn sort_oldest_and_added() {
    let (c, _) = seed().await;
    let oldest: Vec<String> = c.query_media(&MediaQuery { sort: MediaSort::TakenAsc, ..q() }).await.unwrap().into_iter().map(|(m, _)| m.rel_path).collect();
    assert_eq!(oldest, ["a.jpg", "c.mp4", "b.raf", "d.heic"]);
    let added: Vec<String> = c.query_media(&MediaQuery { sort: MediaSort::AddedDesc, ..q() }).await.unwrap().into_iter().map(|(m, _)| m.rel_path).collect();
    assert_eq!(added, ["d.heic", "c.mp4", "b.raf", "a.jpg"]);
}
#[tokio::test] async fn paging_and_count() {
    let (c, _) = seed().await;
    let page = c.query_media(&MediaQuery { limit: 2, offset: 2, ..q() }).await.unwrap();
    assert_eq!(page.iter().map(|(m, _)| m.rel_path.as_str()).collect::<Vec<_>>(), ["a.jpg", "d.heic"]);
    assert_eq!(c.count_media_query(&q()).await.unwrap(), 4);
    assert_eq!(c.count_media_query(&MediaQuery { kinds: vec![MediaKind::Video], ..q() }).await.unwrap(), 1);
}
#[tokio::test] async fn get_media_with_drive_and_not_found() {
    let (c, did) = seed().await;
    let (m, d) = c.query_media(&q()).await.unwrap().remove(0);
    let (m2, d2) = c.get_media_with_drive(m.id).await.unwrap();
    assert_eq!(m2.id, m.id); assert_eq!(d2.id, did); assert_eq!(d.id, did);
    assert!(matches!(c.get_media_with_drive(999).await, Err(dp_core::DpError::NotFound { .. })));
}
```
Run `cargo test -p dp-catalog --test query` → FAIL (methods missing).

- [ ] **Step 3: implement `query.rs`** — build SQL with a `Vec<String>` of WHERE clauses and bound params (no string interpolation of values):
```rust
use crate::sqlite::db;
use dp_core::{Drive, DpResult, MediaKind, MediaQuery, MediaRow, MediaSort};
use sqlx::{sqlite::SqliteArguments, Arguments, SqlitePool};

const SELECT_JOINED: &str = "SELECT m.*, d.id AS d_id, d.name AS d_name, d.volume_uuid AS d_volume_uuid, d.mount_path AS d_mount_path, d.role AS d_role, d.capacity AS d_capacity, d.free AS d_free, d.last_seen_at AS d_last_seen_at FROM media m JOIN drives d ON d.id = m.drive_id";

fn kind_str(k: MediaKind) -> &'static str { match k { MediaKind::Photo => "photo", MediaKind::Video => "video" } }
fn order_by(sort: MediaSort) -> &'static str {
    match sort {
        MediaSort::TakenDesc => "ORDER BY m.taken_at DESC NULLS LAST, m.id DESC",
        MediaSort::TakenAsc => "ORDER BY m.taken_at ASC NULLS LAST, m.id ASC",
        MediaSort::AddedDesc => "ORDER BY m.id DESC",
    }
}
/// Returns (where_sql, args). `args` are bound in order.
fn where_clause<'a>(q: &'a MediaQuery) -> (String, SqliteArguments<'a>) {
    let mut clauses = Vec::new(); let mut args = SqliteArguments::default();
    if !q.kinds.is_empty() { clauses.push(format!("m.kind IN ({})", vec!["?"; q.kinds.len()].join(","))); for k in &q.kinds { let _ = args.add(kind_str(*k)); } }
    if !q.exts.is_empty() { clauses.push(format!("m.ext IN ({})", vec!["?"; q.exts.len()].join(","))); for e in &q.exts { let _ = args.add(e.as_str()); } }
    let sql = if clauses.is_empty() { String::new() } else { format!("WHERE {}", clauses.join(" AND ")) };
    (sql, args)
}
pub(crate) async fn query_media(pool: &SqlitePool, q: &MediaQuery) -> DpResult<Vec<(MediaRow, Drive)>> {
    let q = q.clone().clamped();
    let (w, mut args) = where_clause(&q);
    let _ = args.add(q.limit as i64); let _ = args.add(q.offset as i64);
    let sql = format!("{SELECT_JOINED} {w} {} LIMIT ? OFFSET ?", order_by(q.sort));
    let rows = sqlx::query_with(&sql, args).fetch_all(pool).await.map_err(db)?;
    rows.iter().map(|r| Ok((crate::media::row_to_media(r)?, crate::drives::row_to_drive_prefixed(r, "d_")?))).collect()
}
pub(crate) async fn count_media_query(pool: &SqlitePool, q: &MediaQuery) -> DpResult<u64> {
    let (w, args) = where_clause(q);
    let sql = format!("SELECT COUNT(*) AS n FROM media m {w}");
    let n: i64 = sqlx::query_scalar_with(&sql, args).fetch_one(pool).await.map_err(db)?;
    Ok(n as u64)
}
pub(crate) async fn get_media_with_drive(pool: &SqlitePool, id: i64) -> DpResult<(MediaRow, Drive)> {
    let sql = format!("{SELECT_JOINED} WHERE m.id = ?");
    let row = sqlx::query(&sql).bind(id).fetch_optional(pool).await.map_err(db)?
        .ok_or_else(|| dp_core::DpError::NotFound { message: format!("media {id} not found") })?;
    Ok((crate::media::row_to_media(&row)?, crate::drives::row_to_drive_prefixed(&row, "d_")?))
}
```
Make `row_to_media` / `row_to_drive_prefixed` `pub(crate)`. Move the existing `SELECT_JOINED` string out of `media.rs::list_media_with_drive` into `query.rs` and delete `list_media_with_drive` + its trait method + its test. Wire the three trait methods in `lib.rs`. If `SqliteArguments` lifetimes fight you, collect owned `Vec<String>` params and bind them in a loop on `sqlx::query(&sql)` instead — equivalent. Run `cargo test -p dp-catalog` → PASS.

- [ ] **Step 4: rel_path → error** — in `crates/dp-jobs/src/scan.rs` change `fn rel_path(path, mount_path) -> String` to `-> Option<String>` (None when `strip_prefix` fails). In the per-file pipeline, `None` → `ItemError { code: "path", message: "file is outside the drive root" }` + `record_scan_error`, count as `failed`, skip upsert. Test in `crates/dp-jobs/tests/scan.rs`: unit-test the pure fn via a `#[cfg(test)] mod` in scan.rs: `rel_path("/Volumes/A/x/y.jpg","/Volumes/A") == Some("x/y.jpg")`, `rel_path("/elsewhere/y.jpg","/Volumes/A") == None`. Run `cargo test -p dp-jobs` → PASS.

- [ ] **Step 5: commands** — rewrite `src-tauri/src/commands/media.rs`:
```rust
fn to_item(state: &AppState, row: MediaRow, drive: Drive) -> MediaItem {
    MediaItem { thumb_path: state.store.path(&row.hash, 400).to_string_lossy().into_owned(),
                preview_path: state.store.path(&row.hash, 2000).to_string_lossy().into_owned(),
                drive_name: drive.name, online: drive.online, row }
}
#[tauri::command] pub async fn query_media(state: State<'_, AppState>, query: MediaQuery) -> Result<Vec<MediaItem>, DpError> { Ok(state.catalog.query_media(&query).await?.into_iter().map(|(r, d)| to_item(&state, r, d)).collect()) }
#[tauri::command] pub async fn count_media(state: State<'_, AppState>, query: MediaQuery) -> Result<u64, DpError> { state.catalog.count_media_query(&query).await }
#[tauri::command] pub async fn get_media(state: State<'_, AppState>, id: i64) -> Result<MediaItem, DpError> { let (r, d) = state.catalog.get_media_with_drive(id).await?; Ok(to_item(&state, r, d)) }
```
Register in `generate_handler!`, remove `list_media`.

- [ ] **Step 6: TS client (test first)** — `src/lib/api/media.ts` adds `MediaSort`, `MediaQuery`, `preview_path`, `queryMedia = (query) => invokeApi<MediaItem[]>("query_media", { query })`, `countMedia`, `getMedia = (id) => invokeApi<MediaItem>("get_media", { id })`; delete `listMedia`. Tests: mockIPC asserting command names and arg shapes. Update `GalleryPage.tsx` to `queryMedia({ kinds: [], exts: [], sort: "taken_desc", limit: 500, offset: 0 })` and its test's mock (`query_media`). Keep ThumbGrid for now.

- [ ] **Step 7: verify + commit** — full gates; `pnpm tauri dev` → Gallery still renders. Commit `feat(catalog): media query contract with filters, sort, paging and get_media`.

---

### Task 2.2: Gallery store, type-filter mapping, infinite query hook

**Files:**
- Create: `src/lib/media/typeFilter.ts`, `src/lib/media/typeFilter.test.ts`, `src/features/gallery/store/galleryStore.ts`, `src/features/gallery/store/galleryStore.test.ts`, `src/features/gallery/hooks/useMediaInfinite.ts`, `src/features/gallery/hooks/useMediaInfinite.test.tsx`, `src/features/gallery/hooks/useMediaCount.ts`
- Modify: `src/features/gallery/GalleryPage.tsx`, `GalleryPage.test.tsx`, `package.json` (zustand)

**Interfaces:**
- Produces:
  ```ts
  // typeFilter.ts
  export type TypeFilter = "ALL" | "JPG" | "RAW" | "HEIF" | "PNG" | "VIDEO";
  export const TYPE_FILTERS: TypeFilter[];
  export function typeFilterToQuery(f: TypeFilter): Pick<MediaQuery, "kinds" | "exts">;
  // galleryStore.ts (zustand + persist key "drophoto.gallery")
  export type SortOption = "NEWEST" | "OLDEST" | "ADDED"; export type Density = "Comfortable" | "Compact" | "Dense";
  export const SORT_TO_QUERY: Record<SortOption, MediaSort>; export const DENSITY_ROW_HEIGHT: Record<Density, number>; // 240/180/130
  export const useGalleryStore: UseBoundStore<{ typeFilter; sort; density; setTypeFilter; setSort; setDensity }>;
  export function buildQuery(s: {typeFilter; sort}, limit: number, offset: number): MediaQuery;
  // useMediaInfinite.ts
  export const PAGE_SIZE = 500;
  export function useMediaInfinite(): { items: MediaItem[]; fetchNextPage; hasNextPage; isFetchingNextPage; isError; error; isSuccess };
  // useMediaCount.ts
  export function useMediaCount(): number | undefined;
  ```

- [ ] **Step 1: `pnpm add zustand`.**
- [ ] **Step 2: typeFilter (TDD)** — tests: `typeFilterToQuery("ALL")` → `{kinds:[],exts:[]}`; `"JPG"` → exts `["jpg","jpeg"]`; `"RAW"` → the 8 RAW exts; `"VIDEO"` → `{kinds:["video"],exts:[]}`. Implement as a const table.
- [ ] **Step 3: galleryStore (TDD)** — tests: defaults (`ALL`, `NEWEST`, `Comfortable`); setters update; `buildQuery({typeFilter:"VIDEO",sort:"OLDEST"}, 500, 1000)` → `{kinds:["video"],exts:[],sort:"taken_asc",limit:500,offset:1000}`; persistence: call `useGalleryStore.persist.clearStorage()` in `beforeEach`. Implement with `create(persist(..., { name: "drophoto.gallery", partialize: s => ({ typeFilter, sort, density }) }))` and wrap `localStorage` access errors (persist handles missing storage — no extra code).
- [ ] **Step 4: useMediaInfinite (TDD)** — `useInfiniteQuery({ queryKey: ["media", typeFilter, sort], queryFn: ({pageParam}) => queryMedia(buildQuery(state, PAGE_SIZE, pageParam)), initialPageParam: 0, getNextPageParam: (last, pages) => last.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE })`; `items = data.pages.flat()`. Test with `renderHook` + QueryClientProvider + mockIPC returning 500 then 3 items: `hasNextPage` true after page 1, items length 503 after `fetchNextPage`, false after. `useMediaCount`: `useQuery(["media-count", typeFilter, sort])` → `countMedia(buildQuery(state, 1, 0))`.
- [ ] **Step 5: GalleryPage** — use both hooks; header count from `useMediaCount` (fallback `items.length`); keep `ThumbGrid`; add a "Load more" `Button` (outline, mono) at the bottom when `hasNextPage` (temporary until Task 2.4). Update tests (mock `query_media` + `count_media`).
- [ ] **Step 6: verify + commit** — gates; `pnpm tauri dev`. Commit `feat(gallery): persisted gallery state, type-filter mapping and infinite media query`.

---

### Task 2.3: Formatting helpers + `buildLayout` (pure)

**Files:**
- Create: `src/lib/media/format.ts`, `format.test.ts`, `src/lib/media/layout.ts`, `layout.test.ts`

**Interfaces:**
```ts
// format.ts
export function monthLabel(takenAt: string | null): string;           // "September 2025" | "Undated"
export function monthKey(takenAt: string | null): string;             // "2025-09" | "undated"
export function formatDuration(ms: number | null): string;            // 42000 → "0:42", 75000 → "1:15", null → ""
export function formatExposure(aperture: number | null, shutter: number | null): string; // (2, 0.00125) → "ƒ/2.0 · 1/800s"; (8, 0.5) → "ƒ/8.0 · 0.5s"; nulls → "—"
export function formatIsoFocal(iso: number | null, focal: number | null): string;        // "100 · 35mm", "—"
export function formatCoords(lat: number | null, lon: number | null): string;            // (38.71,-9.13) → "38.71°N 9.13°W"
export function formatTakenAt(iso: string | null): string;            // "12 Sep 2025 · 14:03" | "Unknown"
export function formatDims(w: number | null, h: number | null): string;                  // "6000 × 4000" | "—"
// layout.ts
export type Tile = { item: MediaItem; width: number; height: number; index: number };   // index = position in flat items
export type LayoutItem = { kind: "header"; key: string; label: string; count: number; height: number }
                       | { kind: "row"; key: string; tiles: Tile[]; height: number };
export const HEADER_HEIGHT = 52; export const GAP = 8;
export function buildLayout(items: MediaItem[], containerWidth: number, targetRowHeight: number): LayoutItem[];
```
`buildLayout`: group consecutive items by `monthKey` (items arrive sorted, so consecutive grouping is correct; "undated" still groups); per group emit a header then pack tiles greedily: accumulate ratios (`w/h` or 4/3) until `sum(ratio) * targetRowHeight + GAP*(n-1) >= containerWidth`, then scale the row so widths fill `containerWidth` exactly (height = `(containerWidth - GAP*(n-1)) / sum(ratio)`); the last partial row keeps `targetRowHeight` (no upscale). Clamp ratio to `[0.3, 4]`. `containerWidth <= 0` → `[]`.

- [ ] **Step 1: format tests then impl** (all cases above; use `Intl.DateTimeFormat("en-GB")` for month/date; shutter ≥ 1 → `${s}s`, else `1/${Math.round(1/s)}s`).
- [ ] **Step 2: layout tests then impl** — tests: empty → []; 3 landscape (4:3) items at width 1000, target 240: one header + one row of 3 with equal widths summing to `1000 - 2*GAP` and `height ≈ 246`; 10 items → multiple rows, every full row's widths sum to container within 1px; last row height == target when partial; two months → two headers with correct `count` and labels, undated group labelled "Undated"; `index` continuous across rows/groups; ratio clamp (a 10:1 item treated as 4:1).
- [ ] **Step 3: verify + commit** — `pnpm test -- src/lib/media`, gates. Commit `feat(gallery): formatting helpers and justified-row layout builder`.

---

### Task 2.4: `Tile`, `VirtualGrid` (month headers + justified rows), replace `ThumbGrid`, scroll-to-load

**Files:**
- Create: `src/features/gallery/components/Tile/{index.ts,Tile.tsx,Tile.types.ts,Tile.test.tsx}`, `src/features/gallery/components/VirtualGrid/{index.ts,VirtualGrid.tsx,VirtualGrid.types.ts,VirtualGrid.test.tsx,MonthHeader.tsx,JustifiedRow.tsx}`
- Modify: `src/features/gallery/GalleryPage.tsx`, `GalleryPage.test.tsx`; delete `ThumbGrid/*`; `package.json` (`@tanstack/react-virtual`)

**Interfaces:**
```ts
// Tile
export type TileProps = { tile: Tile; onOpen: (index: number) => void };
// VirtualGrid
export type VirtualGridProps = { items: MediaItem[]; targetRowHeight: number; onOpen: (index: number) => void; onNearEnd?: () => void };
```
Tile: `div` sized by `tile.width/height`, `<img loading="lazy" alt={rel_path} src={thumbUrl(thumb_path)}>`, click/Enter → `onOpen(tile.index)` (role="button", tabIndex 0, `aria-label={rel_path}`), video: play glyph + `formatDuration` badge bottom-right (`data-testid="video-badge"`), hover overlay (gradient) showing `drive_name` and `OFFLINE` when `!online`. VirtualGrid: measures container width with a `ResizeObserver` (hook `useContainerWidth` inside VirtualGrid folder), `buildLayout(items, width - 32 /*p-4*/, targetRowHeight)` memoized, `useVirtualizer({ count: layout.length, getScrollElement, estimateSize: i => layout[i].height + GAP, overscan: 6 })`; renders `MonthHeader` (label + mono count like the design: 19px semibold + mono 10px faint) or `JustifiedRow`; calls `onNearEnd` when the last virtual item index ≥ `layout.length - 3` (debounced by a ref so it fires once per layout length).

- [ ] **Step 1: `pnpm add @tanstack/react-virtual`.**
- [ ] **Step 2: Tile (TDD)** — tests: img alt; click → `onOpen(7)`; Enter key → onOpen; video badge shows "0:42"; OFFLINE label only when offline.
- [ ] **Step 3: VirtualGrid (TDD)** — in jsdom mock `ResizeObserver` (setup helper in the test: trigger with width 1000) and stub `useVirtualizer` via `vi.mock("@tanstack/react-virtual", () => ({ useVirtualizer: () => ({ getVirtualItems: () => layoutIndexes.map(i => ({ index: i, start: i*260, size: 260, key: i })), getTotalSize: () => 5000, measureElement: () => {} }) }))`. Tests: header labels render ("September 2025", count), tiles render with alts, `onNearEnd` called when last index is near end, not called twice for the same length.
- [ ] **Step 4: GalleryPage** — replace ThumbGrid + Load more with `<VirtualGrid items targetRowHeight={DENSITY_ROW_HEIGHT[density]} onOpen={setOpenIndex} onNearEnd={() => hasNextPage && !isFetchingNextPage && fetchNextPage()} />`; `openIndex` state exists but nothing opens yet (Task 2.6). Page container: `flex-1 overflow-hidden` with the grid owning the scroll element. Delete `ThumbGrid`. Update page tests (mock react-virtual the same way via a shared `src/test/mockVirtualizer.ts`).
- [ ] **Step 5: verify + commit** — gates; `pnpm tauri dev`: scroll through a scanned drive, month headers, lazy thumbs, more pages load. Commit `feat(gallery): virtualized justified-row grid with month headers`.

---

### Task 2.5: `GalleryToolbar` — search link, type chips, sort, density

**Files:**
- Create: `src/features/gallery/components/GalleryToolbar/{index.ts,GalleryToolbar.tsx,GalleryToolbar.types.ts,GalleryToolbar.test.tsx,TypeChips.tsx,SortMenu.tsx,DensityToggle.tsx}`, `src/components/ui/dropdown-menu.tsx`, `src/components/ui/toggle-group.tsx` (shadcn)
- Modify: `src/features/gallery/GalleryPage.tsx`, `GalleryPage.test.tsx`

**Interfaces:** `GalleryToolbarProps = { count: number | undefined }` — reads/writes `useGalleryStore` directly (feature-local store is allowed; components still never touch Tauri).

- [ ] **Step 1:** `pnpm dlx shadcn@latest add dropdown-menu toggle-group` (verify they compile on the dark tokens; `--popover` etc. already defined).
- [ ] **Step 2: TypeChips (TDD)** — renders the six chips from `TYPE_FILTERS`; active chip styled like the design (`bg-primary text-primary-foreground border-primary`), others `border-border-2 text-muted-foreground hover:bg-surface hover:text-foreground`, mono 9.5px tracking 0.8px, `-ml-px` to collapse borders; `aria-pressed`; click → `setTypeFilter`. Test: clicking RAW sets store + aria-pressed.
- [ ] **Step 3: SortMenu (TDD)** — shadcn `DropdownMenu` trigger showing current sort (`NEWEST ▾`, mono 10px bordered like the design); items NEWEST/OLDEST/ADDED; test: open, choose OLDEST → store updated (use `userEvent`).
- [ ] **Step 4: DensityToggle (TDD)** — `ToggleGroup type="single"` with three `Rows2/Rows3/Rows4`-style lucide icons (`Rows3`, `LayoutGrid`, `Grid3x3`) and tooltips; test: select Dense → store.
- [ ] **Step 5: GalleryToolbar** — replaces `PageHeader` children: left `GALLERY` label (reuse PageHeader title), a search affordance `<Link to="/search">` styled as the design's search box (`⌘F` hint; uses the same generics-widened Link as GalleryPage with the existing comment), right: TypeChips, SortMenu, DensityToggle, and the count (`{count} items`, mono faint). Wire into GalleryPage (`<PageHeader title="Gallery"><GalleryToolbar count={count} /></PageHeader>`). Tests for the page: changing a chip changes the `query_media` args captured by mockIPC.
- [ ] **Step 6: verify + commit** — gates; `pnpm tauri dev`: chips filter, sort reorders, density changes row height, state survives relaunch. Commit `feat(gallery): toolbar with type chips, sort and density`.

---

### Task 2.6: Lightbox — preview, meta panel, keyboard nav, Reveal in Finder

**Files:**
- Create: `src/lib/hooks/useKeyboardNav.ts`, `useKeyboardNav.test.ts`, `src/lib/api/opener.ts`, `opener.test.ts`, `src/features/gallery/components/Lightbox/{index.ts,Lightbox.tsx,Lightbox.types.ts,Lightbox.test.tsx,MetaPanel.tsx,MetaPanel.test.tsx,MetaSection.tsx,MetaRow.tsx}`
- Modify: `src/features/gallery/GalleryPage.tsx`, `GalleryPage.test.tsx`, `src-tauri/capabilities/default.json` (opener reveal permission)

**Interfaces:**
```ts
// useKeyboardNav.ts
export function useKeyboardNav(opts: { enabled: boolean; onClose(): void; onPrev(): void; onNext(): void }): void; // window keydown Esc/ArrowLeft/ArrowRight
// opener.ts
export const revealInFinder = (path: string) => revealItemInDir(path);   // from @tauri-apps/plugin-opener
// Lightbox
export type LightboxProps = { items: MediaItem[]; index: number; onClose(): void; onPrev(): void; onNext(): void; onNearEnd?(): void };
// MetaPanel
export type MetaPanelProps = { item: MediaItem };
```
Lightbox layout = the design: fixed inset-0 z-50 `bg-[rgba(6,6,6,0.97)] flex`; left area (click = close) with `CLOSE` control + mono counter `01 / 24`, prev/next 38px bordered buttons, `<img src={thumbUrl(preview_path)} className="max-w-full max-h-full object-contain">` with `onError` fallback to `thumbUrl(thumb_path)`; right `aside` 372px `bg-[#0b0b0a] border-l border-border overflow-y-auto p-6`: filename (`rel_path` basename, 20px semibold), mono dim line `formatDims · formatBytes(size) · ext.toUpperCase()`, sections via `MetaSection title="CAMERA"` with `MetaRow label value`: Body/Lens/Exposure/ISO·Focal; CAPTURE: Taken (`formatTakenAt`), Drive (`drive_name` + `OFFLINE` badge when offline); LOCATION: `formatCoords` or "No location data"; PEOPLE: "No people tagged"; TAGS: "No tags". Footer: `Reveal in Finder` outline Button, disabled when `!online`, calls `revealInFinder(joinPath(drive_mount?, rel_path))` — since `MediaItem` has no mount path, add `original_path: string | null` to `MediaItem` (Rust: `drive.mount_path.map(|m| Path::new(&m).join(&row.rel_path).to_string_lossy().into_owned())`) in this task (small Rust + TS type change, test in `commands` is not possible — cover with the catalog→item mapping unit test by extracting `to_item` into `src-tauri/src/commands/media_item.rs` with a `#[cfg(test)]` test using a fake `ThumbStore` root). `onNext` at the last loaded item triggers `onNearEnd` (fetch more) and stays put if no more.

- [ ] **Step 1: useKeyboardNav (TDD)** — tests: Escape→onClose, ArrowRight→onNext, ArrowLeft→onPrev, nothing when `enabled=false`, listener removed on unmount (`removeEventListener` spy).
- [ ] **Step 2: opener.ts (TDD)** — `vi.mock("@tauri-apps/plugin-opener")`; test passes path through. Add `"opener:allow-reveal-item-in-dir"` to `capabilities/default.json` permissions (keep `opener:default`).
- [ ] **Step 3: `original_path`** — Rust `MediaItem.original_path: Option<String>` + TS type + `to_item` extraction with unit test. `cargo test -p drophoto` (the src-tauri crate) must run the unit test — `cargo test --workspace` covers it.
- [ ] **Step 4: MetaPanel (TDD)** — render with a fixture `MediaItem` (camera "Sony α7 IV", lens, aperture 2, shutter 0.00125, iso 100, focal 35, lat/lon, taken_at, online) → assert the formatted rows; offline → OFFLINE badge + Reveal disabled; no GPS → "No location data".
- [ ] **Step 5: Lightbox (TDD)** — tests: shows `03 / 10` counter for index 2 of 10, img src = thumbUrl(preview_path), clicking backdrop → onClose, prev/next buttons, img `onError` swaps to thumb src, pressing ArrowRight → onNext (via the real hook).
- [ ] **Step 6: GalleryPage wiring** — `openIndex: number | null`; `<Lightbox>` when not null with `onPrev/onNext` clamped to `[0, items.length-1]`, `onNearEnd` → `fetchNextPage`. Page test: click a tile (mocked virtualizer) → dialog role visible; Escape closes.
- [ ] **Step 7: verify + commit** — gates; `pnpm tauri dev`: open photo, arrow through, Esc, offline drive → Reveal disabled, online → Finder reveals the file. Commit `feat(gallery): lightbox with metadata panel, keyboard navigation and reveal in Finder`.

---

### Task 2.7: PR

- [ ] `git push -u origin HEAD`; `gh pr create` (title `feat(gallery): Phase 2 — virtualized gallery, filters and lightbox`, body `Closes #<issue>`, summary, test plan incl. unplug test, generated-with trailer). CI green → controller merges with `--squash --subject`.

---

## Self-review
- Spec §8 Phase 2 row: virtualized masonry→justified rows (approved), month grouping ✔ 2.3/2.4, type chips/sort/density ✔ 2.5, lightbox + EXIF panel + ←/→/Esc ✔ 2.6, video badge ✔ 2.4, works offline from thumbs ✔ (preview_path served from the store; `original_path` only for Reveal), online/offline indicator ✔ 2.4/2.6, "insert drive" prompt → the disabled Reveal button with OFFLINE badge satisfies §5.1's affordance for Phase 2. Deferred items closed: rel_path fallback (2.1), limit cap (2.1).
- Types: `MediaItem` gains `preview_path` (2.1) and `original_path` (2.6); `buildQuery` signature used identically in 2.2 hooks; `Tile.index` consumed by `onOpen(index)` in 2.4 and `Lightbox.index` in 2.6; `DENSITY_ROW_HEIGHT` from 2.2 used in 2.4.
- No placeholders; every step has code or exact commands.
