# Phase 4b: Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full-text search across file names, tags, place names, and camera models, with a dedicated Search screen that works fully offline from thumbnails.

**Architecture:** A plain FTS5 table `media_fts` (rowid = `media.id`, NOT contentless — plain is the only shape with unrestricted rowid deletes, and the duplicated text is trivial at personal-catalog scale) kept in sync by catalog code at every mutation point: media upsert, media delete, tag changes. `search_media` runs an FTS `MATCH` (last token gets `*` prefix), ranked by `bm25`, and returns the same `MediaItem`s the gallery uses, so the Search screen reuses the existing grid + lightbox wholesale.

**Tech Stack:** sqlx SQLite (FTS5, unicode61 tokenizer), Rust, React 19 + TS, TanStack Query, existing gallery components.

**Spec:** `docs/superpowers/specs/2026-08-23-phase4-tags-places-search-design.md` (§4)

## Global Constraints

- Same as 4a (they bind every task): no `unwrap`/`expect` in non-test Rust; all errors `DpError`; components never import `@tauri-apps/*`; component folders `index.ts` + `.tsx` + `.types.ts`; TDD with real `SqliteCatalog::open_in_memory()` / mockIPC; pristine test output; coverage thresholds hold.
- Local gates are the merge gate (NO GitHub CI): `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm tauri build --debug --no-bundle`.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Branch `feat/15-search` (exists). Do not push; the controller pushes.
- FTS text is DERIVED data: catalog writes must never fail because of an FTS sync error — the media/tag write commits, the FTS error is logged (`tracing::warn!`) and `rebuild_fts` is the recovery path. (Search staleness is acceptable; losing a photo row is not.)

---

### Task 4b.1: Migration 0006 + FTS module with sync + search

**Files:**
- Create: `crates/dp-catalog/migrations/0006_fts.sql`
- Create: `crates/dp-catalog/src/fts.rs`
- Modify: `crates/dp-catalog/src/lib.rs` (trait + `mod fts`), `crates/dp-catalog/src/media.rs` (`upsert_media`/`delete_media` call sync), `crates/dp-catalog/src/tags.rs` (`tag_media` calls sync for every id after its tx commits)
- Test: `crates/dp-catalog/tests/fts.rs`
- Modify: `dp-jobs` test doubles (`impl Catalog for` gains the new methods)

**Interfaces:**
- Produces:

```rust
// Catalog trait additions
/// Rebuilds one media row's FTS text (stem, tags, place, camera) from
/// current catalog state; deletes the FTS row when the media row is gone.
/// Never propagates FTS errors to the caller of a media/tag write — see
/// Global Constraints; THIS method returns them (callers log).
async fn sync_fts(&self, media_id: i64) -> DpResult<()>;
/// Drops and refills the whole index. Recovery path.
async fn rebuild_fts(&self) -> DpResult<()>;
/// FTS search: every whitespace token AND-ed, the last one prefix-matched
/// (`tok*`), ranked by bm25, joined back to media+drives like query_media.
async fn search_media(&self, query: &str, limit: u32) -> DpResult<Vec<(MediaRow, Drive)>>;
```

- [ ] **Step 1: Migration**

```sql
-- 0006_fts.sql
CREATE VIRTUAL TABLE media_fts USING fts5(
    stem, tags, place, camera,
    tokenize = 'unicode61 remove_diacritics 2'
);
```

(plain FTS5; `media_fts.rowid` is the `media.id`. `place` stays empty until Phase 4c populates `media.place_id`.)

- [ ] **Step 2: Failing tests** (fixtures like `tests/tags.rs`):
  - `upsert_media_indexes_the_stem`: insert `Pictures/IMG_1234.jpg` → `search_media("img_1234", 10)` finds it; `search_media("nope", 10)` empty.
  - `tagging_updates_the_index`: tag a row "beach" → searchable by `beach`; remove the tag → no longer found.
  - `camera_is_searchable`: row with `camera: Some("Canon EOS R5")` → found by `canon` and by `r5`.
  - `last_token_is_prefix_matched`: `search_media("bea", 10)` finds the "beach"-tagged row; earlier tokens are exact (`search_media("bea img_1234", …)`? — no: multi-token `"canon bea"` matches a row with camera Canon AND tag beach).
  - `delete_media_removes_the_fts_row`: delete → unfindable.
  - `rebuild_fts_recovers_a_dropped_index`: `DELETE FROM media_fts` manually → search empty → `rebuild_fts()` → found again.
  - `search_is_diacritic_insensitive`: tag `fête` → found by `fete`.
  - `empty_and_whitespace_queries_return_empty` (no FTS syntax error).
  - `fts_query_syntax_is_escaped`: `search_media("beach\" OR \"x", 10)` must not error — tokens are sanitized (strip `"` and other FTS-special chars) and matched as plain terms.
- [ ] **Step 3: Implement.** `fts.rs`: `sync_fts` = `DELETE FROM media_fts WHERE rowid = ?` then, if the media row exists, `INSERT INTO media_fts(rowid, stem, tags, place, camera) VALUES (?,?,?,?,?)` with stem = file stem of `rel_path` (no extension), tags = space-joined `tag_names_for_media`, place = "" (until 4c), camera = `camera.unwrap_or_default()`. Query builder: split on whitespace, drop empties, strip every non-alphanumeric-except-`_`/-unicode char that FTS treats as syntax (keep letters/digits/`_` per token via `char::is_alphanumeric() || '_'`), quote each token as `"tok"`, last token `"tok" *`? — FTS5 prefix syntax is `tok*` WITHOUT quotes around the star: build `"tok1" AND "tok2" AND "tok3"*`. Empty after sanitize → `Ok(vec![])`.
  Call sites: `media.rs::upsert_media` (after its own write, same connection sequence, log-only), `delete_media` (after successful delete), `tags.rs::tag_media` (after tx commit, for every id in `ids`, log-only). Scan's prune path already goes through `delete_media`.
- [ ] **Step 4: `cargo test --workspace`** green; fmt/clippy; test doubles updated.
- [ ] **Step 5: Commit** `feat(catalog): FTS5 index synced on media and tag writes`

---

### Task 4b.2: search command + TS client

**Files:**
- Create: `src-tauri/src/commands/search.rs` (register in `lib.rs`), `src/lib/api/search.ts` + test
- Test: mockIPC round-trip like `src/lib/api/tags.test.ts`

**Interfaces:**
- Produces:

```rust
/// Max results a single search returns.
const SEARCH_LIMIT_CAP: u32 = 500;
#[tauri::command] pub async fn search_media(state, query: String, limit: u32) -> Result<Vec<MediaItem>, DpError>;
// limit clamped to SEARCH_LIMIT_CAP; rows mapped via the same to_item used by list/query commands (has_thumb etc.)
```

```ts
export async function searchMedia(query: string, limit = 200): Promise<MediaItem[]>;
```

- [ ] Steps: failing tests (unit test the clamp; mockIPC round-trip) → implement (reuse `commands/media_item.rs::to_item`) → gates → commit `feat(search): search command and client`.

---

### Task 4b.3: Search screen

**Files:**
- Modify: `src/features/search/SearchPage.tsx` (exists as an empty route — check `src/app`/feature registry; create the folder structure if it's a stub)
- Create: `src/features/search/hooks/useSearch.ts`, `src/features/search/components/SearchInput/{index.ts,SearchInput.tsx,SearchInput.types.ts}`
- Test: alongside each

**Interfaces:**
- Consumes: `searchMedia`, gallery's `VirtualGrid`/`Tile`/`Lightbox` components, `groupPlan`-style layout helpers (`src/lib/media/layout.ts`).
- Produces:

```ts
// useSearch(query: string)  — debounced 200ms internally
{ items: MediaItem[]; isFetching: boolean; isDebouncing: boolean }
// query key: ["search", debouncedQuery]; enabled only when debouncedQuery.trim() !== ""
```

- [ ] Design: `PageHeader` "Search"; a full-width mono input (autofocused) with placeholder `Search file names, tags, cameras…`; states — empty query → hint text ("TYPE TO SEARCH"); debouncing/fetching → DotLoader; no results → `NO RESULTS FOR "<q>"`; results → count line (`N RESULTS`) + the same justified grid as the gallery with the lightbox on click (no multi-select on search results in this phase — plain clicks only, pass a no-op/absent `onToggle`). Kind chips (ALL/PHOTOS/VIDEOS, reuse the gallery's `TypeChips` if its props allow, else a local copy of the pattern) filter the fetched results client-side on `row.kind` (≤500 rows — no refetch).
- [ ] Steps: failing `useSearch` tests (debounce with fake timers, disabled on empty, key shape) → SearchInput tests → SearchPage tests (all four states, opens lightbox) → implement → gates → commit `feat(search): search screen`.

---

### Task 4b.4: Finalize

- [ ] Full gates; push; PR `Closes #15`, title `feat: full-text search (Phase 4b)`; whole-branch review; merge after gates (local only, no CI).
