# Phase 6 Implementation Plan — Tags page, gallery selection, Settings sub-pages, search in the gallery

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** A UI/UX pass over four surfaces: a real Tags page, grown-up gallery selection, Settings split into sub-pages, and search folded into the gallery (deleting the standalone Search page).

**Architecture:** Three of the four are additive frontend work over small new command surfaces; the fourth (search) is a *consolidation* — `MediaQuery` gains `query: Option<String>` joined against the existing `media_fts` table inside `query_media`/`count_media_query`, so one backend serves browse and search alike and search inherits filters, sort, infinite paging and selection for free. Settings sub-pages need the flat route registry to learn about children.

**Tech Stack:** existing — Rust workspace (dp-core, dp-catalog sqlx/FTS5, commands in src-tauri), React 19 + TS, TanStack Router + Query, Zustand, Vitest + cargo test.

**Spec:** Issue #39 (user priority list, 2026-09-03). Faces is deliberately out of scope — Phase 7.

## Global Constraints

- Safety: no task here may delete, move or modify user photos. Tag deletes/merges/renames change the catalog and (deliberately) queue `.xmp` sidecar rewrites via `sidecar_pending`; they must NEVER write sidecar files directly — the existing `SidecarSyncJob` owns all sidecar writing.
- Migrations 0001–0009 are FROZEN. This phase needs NO new migration (`tags`/`media_tags` from 0005 and `media_fts` from 0006 already exist).
- Dev-port lines (`src-tauri/tauri.conf.json` devUrl, `vite.config.ts`) stay uncommitted — stash-protect if a task must commit `tauri.conf.json`; never alter the updater pubkey, CSP, or asset-protocol scope.
- Any tag mutation touching N media rows must resync FTS for those rows (`fts::sync_fts` is per-media-id — loop, or use the existing rebuild path) and set `sidecar_pending = 1` on them, exactly as `tag_media` already does.
- `MediaQuery`'s new field must be `#[serde(default)]` so every existing caller (gallery, places, organize planner, dashboard) is untouched.
- TDD; tests assert real behavior. Component-folder convention for new components (folder with index.ts, Component.tsx, .types.ts, test).
- CI is deactivated (workflow_dispatch only): `pnpm check` on the final commit is the merge gate, pasted into the PR.

---

### Task 6.1: Search into the gallery (backend + fold-in, delete the Search page)

**Files:**
- Modify: `crates/dp-core/src/types.rs` — `MediaQuery` gains `#[serde(default)] pub query: Option<String>` (doc: trimmed; empty/whitespace behaves as `None`; matched against `media_fts` over stem/tags/place/camera).
- Modify: `crates/dp-catalog/src/query.rs` — when `query` is `Some(non-empty)`, restrict to `id IN (SELECT rowid FROM media_fts WHERE media_fts MATCH ?)`, reusing `fts.rs`'s existing query sanitizer (find it — `search_media` splits/escapes tokens and prefix-matches the last piece; extract it to a shared `pub(crate) fn` rather than duplicating). Sort stays the caller's `MediaSort` (a photo library is browsed by date; FTS rank is not offered) — document that choice. `count_media_query` (or whatever the count path is) gets the same join so the toolbar count is right.
- Modify: `src-tauri/src/commands/media.rs` if it needs to pass the field through (likely nothing — it forwards `MediaQuery`).
- Modify: `src/lib/api/media.ts` — `MediaQuery` type gains `query?: string`.
- Modify: `src/features/gallery/store/galleryStore.ts` — `query: string` state (NOT persisted), `setQuery` (clears selection on actual change, like `setTypeFilter`); `buildQuery` passes `query: query.trim() || undefined`.
- Modify: `src/features/gallery/hooks/useMediaInfinite.ts` — include the query in the react-query key so results refetch; keep `keepPreviousData`-style behavior so the grid doesn't flash empty while typing (check what the search page did with `keepPreviousData` and match it).
- Modify: `src/features/gallery/components/GalleryToolbar/` — add a search input (debounced 200 ms, same as `useSearch` used; clear button; placeholder "Search photos"). Wire to `setQuery`.
- Modify: `src/features/gallery/GalleryPage.tsx` — empty-state copy when a query yields nothing ("No photos match <query>").
- Delete: `src/features/search/` entirely (SearchPage + hooks/useSearch + components + tests) and its registry entry in `src/app/features.ts`; delete `src/lib/api/search.ts`'s `searchMedia` **only if nothing else uses it** — keep `rebuildFts` (grep for callers; the Rust `search_media` command may become dead — if so, remove the command + its catalog fn + tests too, but ONLY after grepping; leave `rebuild_fts` alone).
- Tests: catalog (query filters; combined with kinds/place/missing; empty/whitespace query behaves as no query; unsanitized input like `a"b` doesn't error — it's the existing sanitizer's job), store (buildQuery passes/omits query, selection clears on query change), toolbar (typing debounces into setQuery, clear button), gallery empty state, and removal of the Search route (features registry test).

Commit: `feat(gallery): search folded into the gallery, standalone Search page removed`.

### Task 6.2: Tags page

**Files:**
- Modify: `crates/dp-catalog/src/tags.rs` + trait in `lib.rs` (+ `FailingCatalog` double in `crates/dp-jobs/tests/organize.rs`):
  - `list_tags_with_counts() -> Vec<TagWithCount>` (dp-core type: `{ tag: Tag, count: u64 }`, count = linked media rows, `ORDER BY name COLLATE NOCASE`).
  - `rename_tag(id, new_name)` — trim/validate like `tag_media` does (reuse the command-side validator, don't duplicate); merging semantics if the new name collides with an existing tag: treat as a merge into that tag (document it).
  - `merge_tags(from_ids: &[i64], into_id)` — relink `media_tags`, drop the emptied tags.
  - `delete_tag(id)` — removes the tag and its links.
  - ALL of the above: mark `sidecar_pending = 1` on every affected media row and resync FTS for them, in one transaction, exactly as `tag_media` does.
- Modify: `src-tauri/src/commands/tags.rs` — `list_tags_with_counts`, `rename_tag`, `merge_tags`, `delete_tag`; reuse the existing name validator for rename. Register in `src-tauri/src/lib.rs`.
- Modify: `src/lib/api/tags.ts` — mirrors + round-trip tests.
- Rewrite: `src/features/tags/TagsPage.tsx` — a list of tags with photo counts; per-row actions Rename (inline input or dialog), Merge into… (picker), Delete (confirm dialog stating it removes the tag from N photos and queues sidecar rewrites, never touching photo files); clicking a tag navigates to the gallery filtered by that tag.
- Gallery tag filter: `MediaQuery` gains `#[serde(default)] pub tag_ids: Vec<i64>` (AND semantics not needed — a single tag is enough; use `Vec` so it's future-proof but document that the UI passes at most one) joined via `media_tags`; galleryStore gains `tagId: number | null` + `setTagId` (clears selection on change, not persisted), a removable chip in the toolbar showing the active tag, and the Tags page navigates with it (route state or a store setter — pick the simpler; document).
- Components (folder convention): `src/features/tags/components/TagRow/`, `RenameTagDialog/`, `MergeTagDialog/`, `DeleteTagDialog/`.
- Tests: catalog (counts; rename incl. collision-merge; merge relinks and drops; delete removes links; every mutation sets sidecar_pending on affected rows only and leaves other rows alone), commands (validation rejects), TagsPage (renders counts, each dialog's flow with mockIPC, navigation to the filtered gallery), gallery tag filter (store + query).

Commit: `feat(tags): tag management page with counts, rename, merge and delete`.

### Task 6.3: Gallery selection

**Files:**
- Modify: `src/features/gallery/store/galleryStore.ts` — `focusIndex: number | null` (roving focus, not persisted), `setFocusIndex`, `selectAll(ids)`, `deselectRange(ids)` (or make `selectRange` take a mode), `invertSelection(allIds)`.
- Modify: `src/features/gallery/GalleryPage.tsx` — keyboard handling on the grid container: `⌘A` select all loaded items (document: "loaded", since paging is infinite — say so in the UI count), `Escape` (existing) clears, arrow keys move focus (Left/Right by one, Up/Down by a row — the row width comes from the justified layout; read `VirtualGrid`'s layout to find items-per-row, or track it), `Space` toggles the focused item, `Shift+Arrow` extends the selection from the anchor, `Enter` opens the lightbox. Must not hijack keys while an input is focused (the new search box!) or a dialog/lightbox is open — check `document.activeElement`/existing panel-open flags.
- Modify: `src/features/gallery/components/Tile/` — reflect focus (`data-focused`, visible ring) and `aria-selected`; keep existing click semantics.
- Modify: `src/features/gallery/components/MonthHeader/` — becomes clickable: "select all N in September 2026" (button with an aria-label; clicking selects that section's ids; cmd-click adds).
- Modify: `src/features/gallery/components/SelectionBar/` — show `N selected` (and `of M loaded`), add SELECT ALL / INVERT buttons alongside TAG / PLACE / CLEAR.
- Tests: store (selectAll/invert/deselectRange/focus), GalleryPage keyboard (each binding, and that typing in the search box does NOT trigger ⌘A/Space handling), MonthHeader select, SelectionBar counts/actions.

Commit: `feat(gallery): select-all, keyboard navigation and per-month selection`.

### Task 6.4: Settings sub-pages

**Files:**
- Modify: `src/app/registry.ts` + `src/app/router.tsx` — let a feature module declare `children: FeatureRoute[]`; build nested routes for them; keep the flat case working. Sidebar active-state matching becomes `pathname === f.path || pathname.startsWith(f.path + "/")`.
- Modify: `src/app/features.ts` — Settings declares children.
- Create: `src/features/settings/SettingsLayout` (component folder) — a left sub-nav (list of sub-pages) + `<Outlet/>`; the section groups:
  - **General** — Updates, Quality (preview size).
  - **Library** — Storage, Cache location, Organize defaults.
  - **Maintenance** — Tools, Sidecars.
  - **Danger zone** — Reset, Uninstall.
  (Each group is a route: `/settings` redirects to or renders General; `/settings/library`, `/settings/maintenance`, `/settings/danger`.)
- Modify: `src/features/settings/SettingsPage.tsx` — becomes the layout host; the existing section components move under the group pages unchanged (they already own their own data via hooks — verify `useSettingsData` isn't fetching for sections that are no longer mounted; if it is, either split the hook per group or leave it, but document the choice).
- Tests: router/registry (nested route resolves; sidebar active state for a child path), each group page renders its sections (mockIPC), and the existing SettingsPage tests are re-pointed rather than deleted.

Commit: `feat(settings): grouped sub-pages with a left sub-navigation`.

### Task 6.5: Finalize

- Full gates: `pnpm check` (lint, typecheck, coverage, cargo fmt/clippy/test, debug tauri build) on the final commit.
- Whole-branch review + ONE fix wave + scoped re-review. Extra scrutiny: the FTS join's interaction with `place_id`/`missing`/`tag_ids` filters and with paging (offset correctness when a query is active); tag mutations' transaction boundaries and sidecar_pending fan-out; keyboard handling not stealing keys from inputs/dialogs; no route left dangling after the Search page's removal.
- Bump 0.7.0, PR `Closes #39` titled `feat: tags page, gallery selection, settings sub-pages, search in gallery (Phase 6)`, paste `pnpm check` output as the test evidence (CI is off), squash-merge, release v0.7.0 via `scripts/release.sh 0.7.0` (key is Keychain-only now; eject any mounted drophoto DMGs first).
- Update memory + status artifact. Tell the user: search now lives in the gallery toolbar; the Tags page manages tags; ⌘A / arrows / Space work in the grid; Settings is grouped. Faces is next (Phase 7 — Vision detection + a downloadable embedding model).
