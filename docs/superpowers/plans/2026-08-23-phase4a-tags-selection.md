# Phase 4a: Selection, Tags & XMP Sidecars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-select photos in the gallery and bulk-tag them; tags live in the catalog AND in per-file XMP sidecars so the drives stay self-describing; cancelled jobs report real tallies.

**Architecture:** Tags are catalog rows (`tags`/`media_tags`) written through one `tag_media` call that also marks rows `sidecar_pending`; a `SidecarSyncJob` (same JobRunner machinery as scan/organize) flushes pending rows to `<file name>.xmp` sidecars via exiftool; scan imports existing sidecar subjects; organize/revert move a file's sidecar with it. UI: selection state in the gallery Zustand store, a selection bar, and a TagPanel popover.

**Tech Stack:** Rust (sqlx SQLite, async-trait, exiftool CLI), React 19 + TS, Zustand, TanStack Query, shadcn/Radix Popover, Vitest + mockIPC.

**Spec:** `docs/superpowers/specs/2026-08-23-phase4-tags-places-search-design.md` (§3; naming rule in §1.1)

## Global Constraints

- No `unwrap`/`expect` in non-test Rust; all errors are `DpError` (`crates/dp-core/src/error.rs`).
- Components never import `@tauri-apps/*` — only `src/lib/api/*` and `src/lib/hooks/useTauriEvent.ts` do.
- Every component folder: `index.ts` + `Component.tsx` + `Component.types.ts` (+ optional `.constants.ts`), per CLAUDE.md.
- TDD: failing test first, then code. Rust integration tests run against real temp filesystems and real `SqliteCatalog::open_in_memory()`; exiftool is on PATH in dev/test.
- Sidecar naming (spec §1.1): append `.xmp` to the FULL file name — `IMG_001.jpg` → `IMG_001.jpg.xmp`. Never Adobe-style stem replacement (RAW+JPEG pairs would collide).
- Deny-list: every file write/move goes through `dp_core::denylist::is_denied_path(abs, mount, home)` first.
- Test output pristine (no stray prints); coverage thresholds must hold (`pnpm test:coverage`).
- Local gates are the merge gate (NO GitHub CI): `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm tauri build --debug --no-bundle`.
- Every commit ends with trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Working branch: `feat/13-tags-selection` (exists). Do not push; the controller pushes.

---

### Task 4a.1: Migration 0005 + catalog tags module

**Files:**
- Create: `crates/dp-catalog/migrations/0005_tags.sql`
- Create: `crates/dp-catalog/src/tags.rs`
- Modify: `crates/dp-catalog/src/lib.rs` (trait methods + `mod tags`), `crates/dp-catalog/src/sqlite.rs` only if trait impl lives there (follow how `sources.rs` wires its functions into `impl Catalog for SqliteCatalog`)
- Modify: `crates/dp-core/src/types.rs` (`Tag`, `MediaRow.sidecar_pending`)
- Modify: `crates/dp-catalog/src/media.rs` (SELECT lists gain `sidecar_pending`)
- Test: `crates/dp-catalog/tests/tags.rs`
- Modify: every test double implementing `Catalog` (search `impl Catalog for` in `crates/dp-jobs/tests/`) gains the new methods (return `Ok(default)`)

**Interfaces:**
- Consumes: existing `Catalog` trait style (`#[async_trait]`, free functions per module taking `&SqlitePool`).
- Produces (later tasks rely on these exact signatures):

```rust
// dp-core
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Tag { pub id: i64, pub name: String }
// MediaRow gains: pub sidecar_pending: bool,

// Catalog trait additions
async fn list_tags(&self) -> DpResult<Vec<Tag>>;
/// (media_id, tag) pairs for every id in `ids`, tags ordered by name.
async fn tags_for_media(&self, ids: &[i64]) -> DpResult<Vec<(i64, Tag)>>;
/// Creates any missing tags in `add` (name-insensitive), links them to every id,
/// unlinks every tag id in `remove`, and sets `sidecar_pending = 1` on every id
/// whose tag set actually changed. Whole call in one transaction.
async fn tag_media(&self, ids: &[i64], add: &[String], remove: &[i64]) -> DpResult<()>;
/// Tag names for one media row, ordered by name (for sidecar writing).
async fn tag_names_for_media(&self, media_id: i64) -> DpResult<Vec<String>>;
async fn list_sidecar_pending(&self, drive_id: i64) -> DpResult<Vec<MediaRow>>;
async fn clear_sidecar_pending(&self, media_id: i64) -> DpResult<()>;
```

- [ ] **Step 1: Migration**

```sql
-- 0005_tags.sql
CREATE TABLE tags (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE media_tags (
    media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (media_id, tag_id)
);
ALTER TABLE media ADD COLUMN sidecar_pending INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Failing tests** in `tests/tags.rs` (reuse the `nm`/`drive` fixture helpers style from `tests/media.rs`):
  - `tag_media_creates_links_and_marks_pending`: two media rows; `tag_media(&[a,b], &["Trip".into(),"beach".into()], &[])`; `list_tags()` has 2 tags; `tags_for_media(&[a])` returns both — assert names `["beach", "Trip"]` (queries use `ORDER BY name COLLATE NOCASE`); both rows now have `sidecar_pending` via `list_sidecar_pending(drive_id)` returning 2 rows.
  - `tag_media_is_name_case_insensitive`: adding `"Beach"` then `"beach"` yields one tag row, linked once.
  - `tag_media_remove_unlinks_and_marks_pending`: add then remove; `tags_for_media` empty; row pending again after `clear_sidecar_pending` + remove.
  - `tag_media_noop_does_not_mark_pending`: adding an already-linked tag leaves `sidecar_pending = 0` (after clearing); removing a not-linked tag id likewise.
  - `clear_sidecar_pending_clears_one_row`.
  - `tags_for_media_empty_ids_returns_empty` (no SQL error on empty `IN ()`).
- [ ] **Step 3: Run — expect compile failures** (`cargo test -p dp-catalog --test tags`).
- [ ] **Step 4: Implement** `tags.rs` free functions + wire into `impl Catalog for SqliteCatalog`. Notes: build `IN (?,?,…)` lists like `organized_hashes` does; guard `ids.is_empty()`/`add.is_empty() && remove.is_empty()` with early `Ok`; "actually changed" = `rows_affected > 0` on the link INSERT (`INSERT OR IGNORE`) or unlink DELETE, tracked per media id; use a transaction (`pool.begin()`).
- [ ] **Step 5: Add `sidecar_pending` to `MediaRow`** and to every `SELECT` in `media.rs`/`organize.rs` that maps `MediaRow` (grep `rel_path,` in queries). Update `dp-jobs` test doubles.
- [ ] **Step 6: `cargo test --workspace`** green; fmt+clippy clean.
- [ ] **Step 7: Commit** `feat(catalog): tags, media_tags and sidecar_pending`

---

### Task 4a.2: Cancelled jobs carry real tallies

**Files:**
- Modify: `crates/dp-jobs/src/lib.rs` (`JobEvent::Cancelled`), `crates/dp-jobs/src/runner.rs:81,88`
- Modify: `src/lib/api/scan.ts` (TS union), `src/lib/jobs/onTerminalEvent.ts`, `src/features/organize/hooks/useOrganizeRun.ts`, `src/features/organize/hooks/useRevertRun.ts` (cancelled events now update tallies)
- Test: existing `crates/dp-jobs/tests/` runner/scan cancel tests; `src/lib/jobs/onTerminalEvent.test.ts`; `useOrganizeRun`/`useRevertRun` tests

**Interfaces:**
- Produces: `JobEvent::Cancelled { job_id: String, ok: u64, failed: u64, skipped: u64 }`; TS `{ kind: "cancelled"; job_id: string; ok: number; failed: number; skipped: number }`.

- [ ] **Step 1: Failing Rust test** — extend the existing cancel test (find it: `grep -rn cancelled crates/dp-jobs/tests`) to assert the `Cancelled` event's `ok` equals the files processed before the cancel.
- [ ] **Step 2: Implement** — runner.rs:81 becomes `JobEvent::Cancelled { job_id: id.clone(), ok: outcome.ok, failed: outcome.failed, skipped: outcome.skipped }`; the `Ok(Err(_)) if token.is_cancelled()` arm (line 88) uses zeros (no outcome available). Fix all Rust match sites (`cargo build` finds them).
- [ ] **Step 3: TS** — update the union in `src/lib/api/scan.ts`; `onTerminalEvent`'s cancelled toast becomes `` toast(`${label} cancelled — ${event.ok} file${event.ok === 1 ? "" : "s"} done`) ``; `useOrganizeRun`/`useRevertRun` treat `cancelled` like `finished` for tally accumulation (Done screens show real counts; `useRevertRun`'s "reverted" success still requires `finished` with `failed === 0`). Update test fixtures that emit `{kind:"cancelled"}` to include zeros.
- [ ] **Step 4: Full gates** for both languages.
- [ ] **Step 5: Commit** `fix(jobs): cancelled events carry real tallies`

---

### Task 4a.3: Sidecar read/write in dp-metadata

**Files:**
- Create: `crates/dp-metadata/src/sidecar.rs`
- Modify: `crates/dp-metadata/src/lib.rs` (export `Sidecars`, `ExiftoolSidecars`, `sidecar_path`)
- Test: `crates/dp-metadata/tests/sidecar.rs` (real exiftool, real tempdir)

**Interfaces:**
- Produces:

```rust
/// `IMG_001.jpg` → `IMG_001.jpg.xmp` (spec §1.1 — full name + ".xmp").
pub fn sidecar_path(media_path: &Path) -> PathBuf;

#[async_trait::async_trait]
pub trait Sidecars: Send + Sync {
    /// Replaces the sidecar's XMP-dc:Subject list with `subjects` (sorted, deduped
    /// by caller). Creates the sidecar if absent; never touches the media file.
    async fn write_subjects(&self, media_path: &Path, subjects: &[String]) -> DpResult<()>;
    /// Subjects from `sidecar_path(media_path)`; Ok(vec![]) when no sidecar exists.
    async fn read_subjects(&self, media_path: &Path) -> DpResult<Vec<String>>;
}
pub struct ExiftoolSidecars { /* bin: PathBuf, like ExiftoolProvider */ }
impl ExiftoolSidecars { pub fn new(bin: impl Into<PathBuf>) -> Self; pub fn from_path() -> Self; }
```

- [ ] **Step 1: Failing tests**: `sidecar_path_appends_xmp` (`/a/IMG_001.jpg` → `/a/IMG_001.jpg.xmp`); `write_then_read_round_trips` (write `["beach","Trip"]` next to a real tiny jpg fixture, read back same, media file bytes unchanged); `write_creates_missing_sidecar_from_template`; `write_replaces_existing_subjects_preserving_other_xmp` (pre-write a sidecar via exiftool with `-XMP-dc:Creator=me` and one subject; after `write_subjects(["x"])`, Creator survives, subjects == `["x"]`); `read_missing_sidecar_is_empty`; `subjects_with_xml_special_chars_round_trip` (`fête & <friends>`).
- [ ] **Step 2: Run — fail.**
- [ ] **Step 3: Implement.** Creation path: render a minimal XMP packet ourselves (deterministic, no exiftool source-file quirks), XML-escaping `& < > " '`:

```rust
fn render_new_sidecar(subjects: &[String]) -> String {
    let items: String = subjects.iter()
        .map(|s| format!("     <rdf:li>{}</rdf:li>\n", xml_escape(s)))
        .collect();
    format!(
        "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n\
         <x:xmpmeta xmlns:x=\"adobe:ns:meta/\">\n <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n\
         \x20 <rdf:Description rdf:about=\"\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n\
         \x20  <dc:subject>\n    <rdf:Bag>\n{items}    </rdf:Bag>\n   </dc:subject>\n\
         \x20 </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end=\"w\"?>\n"
    )
}
```

  Existing-sidecar path: `exiftool -overwrite_original -XMP-dc:Subject= -XMP-dc:Subject=<s1> … <sidecar>` (first bare `=` clears the list; one arg per subject; `tokio::process::Command`, map `NotFound` like `ExiftoolProvider::read` does). Read path: `exiftool -json -XMP-dc:Subject <sidecar>`, parse with `serde_json` (`Subject` may be a string OR an array — handle both). Write via a temp file + rename for the template path.
- [ ] **Step 4: Tests green; fmt/clippy.**
- [ ] **Step 5: Commit** `feat(metadata): XMP sidecar read/write (dc:Subject)`

---

### Task 4a.4: Scan imports sidecar tags

**Files:**
- Modify: `crates/dp-jobs/src/scan.rs` (`ScanDeps` gains `sidecars: Arc<dyn Sidecars>`; per-file processing), `src-tauri/src/state.rs` + scan command wiring (construct `ExiftoolSidecars::from_path()` once on `AppState`)
- Test: `crates/dp-jobs/tests/scan.rs`

**Interfaces:**
- Consumes: `Sidecars::read_subjects`, `Catalog::tag_media`.
- Produces: scan behaviour only — after `upsert_media` returns `media_id`, if `sidecar_path(path)` exists: `read_subjects` → non-empty → `catalog.tag_media(&[media_id], &subjects, &[]).await` (union — never removes catalog tags), then `catalog.clear_sidecar_pending(media_id)` **only if** the row was not already pending before import (simplest correct rule: do NOT clear; leave pending semantics to the sync job — importing identical tags marks nothing pending because `tag_media` no-ops don't set the flag, per Task 4a.1).
- Sidecar read errors: `record_scan_error` + continue (never fail the file).
- `.xmp` files themselves must never be indexed as media (they aren't — extension filter — add a test proving it).

- [ ] **Step 1: Failing test** `scan_imports_sidecar_subjects_as_tags`: temp drive with `Pictures/a.jpg` (real tiny jpg fixture) + `Pictures/a.jpg.xmp` written via `ExiftoolSidecars` (or the template) with `["holiday"]`; after scan, `tags_for_media` on the row returns `holiday`, and `list_sidecar_pending` does NOT contain the row. Second test: corrupt `b.jpg.xmp` → row scanned fine, `scan_errors` row recorded.
- [ ] **Step 2–4: implement, green, gates.**
- [ ] **Step 5: Commit** `feat(scan): import XMP sidecar tags`

---

### Task 4a.5: SidecarSyncJob + auto-trigger

**Files:**
- Create: `crates/dp-jobs/src/sidecar_sync.rs` (`mod` + re-export in `lib.rs`)
- Create: `src-tauri/src/commands/sidecars.rs` (register in `lib.rs`)
- Modify: `src/lib/api/scan.ts` or new `src/lib/api/sidecars.ts` (`startSidecarSyncAll(): Promise<string[]>`), `src/components/JobEventsBridge/JobEventsBridge.tsx`
- Test: `crates/dp-jobs/tests/sidecar_sync.rs`; bridge test

**Interfaces:**
- Consumes: `Catalog::{list_sidecar_pending, tag_names_for_media, clear_sidecar_pending}`, `Sidecars::write_subjects`, `dp_core::denylist::is_denied_path`, `AppState::start_job`-style admission (add `start_sidecar_sync(drive_id, make_job)` using kind `"sidecar"` — the shared per-drive one-job-at-a-time rule applies).
- Produces:

```rust
pub struct SidecarSyncDeps {
    pub catalog: Arc<dyn Catalog>,
    pub sidecars: Arc<dyn Sidecars>,
    pub home: Option<PathBuf>,
}
pub struct SidecarSyncJob { /* new(id: String, drive: Drive, deps: SidecarSyncDeps) */ }
```

Command `start_sidecar_sync_all() -> Vec<String>`: for every online drive whose `list_sidecar_pending` is non-empty, start a `SidecarSyncJob` (admission refusals are skipped silently — another job on that drive means the sweep retries on the next trigger); returns started job ids.

- [ ] **Step 1: Failing job tests** (mirror `tests/revert.rs` structure: real tempdir, real catalog, run job to completion, collect events):
  - `writes_pending_sidecars_and_clears_flags`: 2 pending rows → both `.xmp` files exist with the rows' tag names sorted; flags cleared; `Finished { ok: 2 }`.
  - `denied_path_is_failed_and_flag_kept` (`Foo.app/Contents/x.jpg` pending row): no write, `ItemError` code `"denied"`, flag still set.
  - `missing_file_is_failed_and_flag_kept` (row whose file was deleted): `ItemError` `"not_found"`, flag kept.
  - `offline_drive_fails_job` (mount None → `Finished`/failed path per how ScanJob handles it — mirror it).
  - `cancel_stops_early` with `Cancelled { ok: 1, .. }` (uses Task 4a.2's tallies).
- [ ] **Step 2–3: implement, green.** Job body: resolve+canonicalize mount; for each pending row: cancel check → abs = `mount.join(rel_path)` → deny check (both the media path and its `sidecar_path` — same `is_denied_path` args as scan) → `symlink_metadata(abs)` exists → `tag_names_for_media` → `write_subjects` → `clear_sidecar_pending` → progress event. Tallies + `catch_unwind` + `JobOutcome` exactly like `RevertJob`.
- [ ] **Step 4: Command + `AppState::start_sidecar_sync`** (`start_job("sidecar", …)` — id prefix `sidecar`), TS client, and the **trigger**: in `JobEventsBridge`, after `onTerminalEvent` of a `finished` scan job (`event.job_id.startsWith("scan-")`), call `startSidecarSyncAll()` (fire-and-forget, `.catch(() => {})`); also on the `drives:changed` Tauri event (add a second `useTauriEvent` there). Bridge tests: emits trigger on scan finish, not on organize finish; drives:changed triggers.
- [ ] **Step 5: Full gates.**
- [ ] **Step 6: Commit** `feat(jobs): sidecar sync job with auto-trigger`

---

### Task 4a.6: Organize & revert move sidecars

**Files:**
- Modify: `crates/dp-jobs/src/organize.rs` (`apply_move`), `crates/dp-jobs/src/revert.rs` (`apply_revert`), `OrganizeDeps` gains nothing (pure fs move)
- Test: `crates/dp-jobs/tests/organize.rs`, `crates/dp-jobs/tests/revert.rs`

**Interfaces:**
- Consumes: `dp_metadata::sidecar_path`, existing `MoveStrategy` (`deps.strategy.move_file`).
- Produces: behaviour — after a successful media move `from → to`: if `sidecar_path(from)` exists, move it to `sidecar_path(to)` with the same strategy; on sidecar-move failure: item STAYS `Moved`, an `ItemError` event is emitted (code `"sidecar"`), and the row is marked `sidecar_pending = 1` so the sync job recreates it at the new path. Add the narrow catalog method for that (in Task 4a.1's `tags.rs` module, with its own test):

```rust
async fn mark_sidecar_pending(&self, media_id: i64) -> DpResult<()>;
```

- [ ] **Step 1: Failing tests**: `organize_moves_the_sidecar_with_the_file` (create `a.jpg` + `a.jpg.xmp`; after organize, both live under `archive/...`, old paths gone); `revert_moves_the_sidecar_back`; `sidecar_move_failure_marks_pending_not_failed` (pre-create a colliding directory at the sidecar destination so the rename fails; item Moved, row pending, ItemError code `"sidecar"`).
- [ ] **Step 2–3: implement, green.** Deny-list: the media move already validated both directories; the sidecar shares them — still call `escapes_mount` on both sidecar paths (cheap, lexical) before moving.
- [ ] **Step 4: Full gates.**
- [ ] **Step 5: Commit** `feat(organize): sidecars travel with their files`

---

### Task 4a.7: Tag commands + TS API

**Files:**
- Create: `src-tauri/src/commands/tags.rs` (register in `lib.rs`), `src/lib/api/tags.ts` + `src/lib/api/tags.test.ts`
- Test: mockIPC round-trip tests like `src/lib/api/sources.test.ts`

**Interfaces:**
- Produces:

```rust
#[tauri::command] pub async fn list_tags(state) -> Result<Vec<Tag>, DpError>;
#[tauri::command] pub async fn tags_for_media(state, media_ids: Vec<i64>) -> Result<Vec<(i64, Tag)>, DpError>;
#[tauri::command] pub async fn tag_media(state, media_ids: Vec<i64>, add: Vec<String>, remove: Vec<i64>) -> Result<(), DpError>;
```

```ts
export type Tag = { id: number; name: string };
export async function listTags(): Promise<Tag[]>;
export async function tagsForMedia(mediaIds: number[]): Promise<[number, Tag][]>;
export async function tagMedia(input: { mediaIds: number[]; add: string[]; remove: number[] }): Promise<void>;
```

`tag_media` command additionally fire-and-forgets a sidecar sweep for the touched drives? — NO (YAGNI): the UI calls `startSidecarSyncAll()` after a successful `tagMedia` mutation (Task 4a.9), reusing the existing sweep.

- [ ] Steps: failing mockIPC tests → command impls (trim/reject empty tag names: `add` entries `trim()`ed, empties filtered server-side; > 64 chars → `Unsupported`) → green → gates → commit `feat(tags): tag commands and client`.

---

### Task 4a.8: Gallery multi-select + selection bar

**Files:**
- Modify: `src/features/gallery/store/galleryStore.ts` (selection state — NOT persisted: exclude from `partialize`), `src/features/gallery/components/Tile/*`, `src/features/gallery/GalleryPage.tsx`, `src/features/gallery/components/VirtualGrid/*` (pass-through props only)
- Create: `src/features/gallery/components/SelectionBar/{index.ts,SelectionBar.tsx,SelectionBar.types.ts}`
- Test: alongside each

**Interfaces:**
- Produces (store additions):

```ts
selectedIds: number[];            // media ids, insertion-ordered
anchorIndex: number | null;       // index in the loaded list, for shift-range
toggleSelected: (id: number, index: number) => void;
selectRange: (ids: number[]) => void;   // adds, does not clear
clearSelection: () => void;
```

Tile: `TileProps` gains `selected: boolean; onToggle: (index: number, shiftKey: boolean) => void;`. Click handling in `Tile.tsx`: `onClick={(e) => { if (e.metaKey || e.ctrlKey) onToggle(tile.index, false); else if (e.shiftKey) onToggle(tile.index, true); else onOpen(tile.index); }}` (shift also prevents text selection: `onMouseDown={(e) => e.shiftKey && e.preventDefault()}`). Selected style: 2px inset ring (`ring-2 ring-foreground ring-inset`) + a small check square top-left.

`SelectionBar` props: `{ count: number; onTag: () => void; onClear: () => void }`; renders `N SELECTED` (mono, 10px, tracking) + `TAG` + `CLEAR` buttons in a bottom bar (`border-t border-border bg-background`); returns `null` when `count === 0`. GalleryPage computes shift-ranges (anchor→index over the loaded items array) and clears selection on unmount (`useEffect` cleanup calling `clearSelection`).

- [ ] Steps: failing store tests (toggle/range/clear/anchor; persisted `partialize` excludes selection — assert `localStorage` payload lacks `selectedIds`) → Tile interaction tests (`fireEvent.click(el, { metaKey: true })` selects, plain click opens) → SelectionBar tests → implement → `pnpm test:coverage` green → commit `feat(gallery): multi-select and selection bar`.

---

### Task 4a.9: TagPanel + lightbox tags

**Files:**
- Create: `src/features/gallery/components/TagPanel/{index.ts,TagPanel.tsx,TagPanel.types.ts}`, `src/features/gallery/hooks/useTags.ts`
- Modify: `src/features/gallery/GalleryPage.tsx` (SelectionBar `onTag` opens TagPanel), `src/features/gallery/components/Lightbox/MetaPanel.tsx` (TAGS row: chips + `+` opening TagPanel for the single item)
- Test: alongside each

**Interfaces:**
- Consumes: `listTags`, `tagsForMedia`, `tagMedia`, `startSidecarSyncAll` (Task 4a.5/4a.7).
- Produces:

```ts
// useTags(mediaIds: number[])
{
  allTags: Tag[];                                  // ["tags"] query
  states: Record<number, "all" | "some">;          // tagId → coverage of mediaIds (["media-tags", ids] query)
  apply: (input: { add: string[]; remove: number[] }) => void;  // mutation
  isApplying: boolean;
}
```

TagPanel (`{ mediaIds: number[]; open: boolean; onClose: () => void }`): Radix Popover/Dialog matching `SourcesDialog` styling; text input filters `allTags` (case-insensitive) and offers `CREATE "<input>"` when no exact match; each row is a checkbox — checked (`all`), indeterminate (`some`), unchecked; toggling stages changes; APPLY runs `apply`, which on success invalidates `["tags"]`, `["media-tags"]`, `["media"]` and fire-and-forgets `startSidecarSyncAll()`. MetaPanel TAGS row shows the item's tag chips (from `tagsForMedia([id])`).

- [ ] Steps: failing `useTags` tests (states derivation: all/some; apply invalidates + sweeps) → TagPanel tests (filter, create offer, tri-state, apply payload) → MetaPanel test (chips render) → implement → gates → commit `feat(gallery): tag panel and lightbox tags`.

---

### Task 4a.10: Finalize

- [ ] Run every global gate; fix stragglers.
- [ ] `git push`, PR `Closes #13` (base `main`), title `feat: gallery selection, tags and XMP sidecars (Phase 4a)`.
- [ ] Controller: final whole-branch review + merge (local gates are the merge gate; no CI).
