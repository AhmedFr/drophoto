# Phase 5d Implementation Plan — missing files, sidecar health, cache location, template defaults

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Close out the original spec's Phase 5 (§8): missing-file detection, sidecar health check, cache location, and organize-template defaults.

**Architecture:** No new migrations — `media.missing_at` (0001) and `media.sidecar_pending` (0005) already exist, and everything else lives in the key-value `settings` table. Missing-file detection is a scan-side reconcile against the walked file set. Sidecar health is cheap catalog counts plus an fs-existence sweep. Cache location is move-files-then-relaunch (no hot-swapping the ThumbStore Arc). Template defaults are settings-backed fallbacks for `get_rule`'s None branch.

**Tech Stack:** existing — Rust workspace (dp-core/dp-catalog/dp-jobs, sqlx), Tauri 2 commands + dialog/process plugins, React 19 + TS, TanStack Query, Vitest + cargo test.

**Spec:** docs/superpowers/specs/2026-08-22-drophoto-design.md §8 Phase 5 row ("Sidecar health check, cache location, templates defaults, rescan/rehash, missing-file detection" — rescan/rehash shipped in 5a). Issue #35.

## Global Constraints

- Safety: NOTHING here may delete, move, or modify user photos or `.xmp` sidecars on disk. Missing-file cleanup removes CATALOG ROWS only. The cache move touches only the app's own thumbs directory.
- Migrations 0001–0009 are FROZEN; this phase needs NO new migration (assert none is added).
- Dev-port lines (`src-tauri/tauri.conf.json` devUrl, `vite.config.ts`) stay uncommitted — stash-protect when committing `tauri.conf.json`; never alter the updater pubkey or CSP.
- Fail-closed skip-path semantics from 5a/5b must not regress; `find_skip_match` criteria unchanged.
- Marking rows missing must be conservative: only for the drive being scanned, only under sources that were actually walked in THIS scan (an enabled source whose root failed to open contributes NO marks — a vanished folder is handled by the walk erroring, not by mass-marking).
- TDD; tests assert real behavior. Component-folder convention for new components.

---

### Task 5d.1: Missing-file detection

**Files:**
- Modify: `crates/dp-catalog/src/media.rs` + `crates/dp-catalog/src/lib.rs` (trait): `reconcile_missing(drive_id, source_id, seen_rel_paths: &[String]) -> DpResult<u64>` — stamps `missing_at = now` on rows of that drive+source whose `rel_path` is not in `seen_rel_paths` and whose `missing_at IS NULL` (keep first-detected time), and CLEARS `missing_at` on rows that ARE in the set (fixes the ledgered 5a follow-up: incremental skip never cleared it). Use a temp table for the seen set (chunked inserts, 16k+ rows). Returns newly-marked count.
- Modify: `crates/dp-jobs/src/scan.rs`: after processing each source's walk (the walk already produces the per-source file list), call `reconcile_missing` with the rel_paths actually seen. A source whose walk errored is skipped entirely (no marks). Cancelled scans skip reconcile (partial walks must not mark).
- Modify: `crates/dp-core/src/types.rs`: `MediaQuery` gains `missing: Option<bool>` (None = include all — preserves existing callers; Some(false) = only present; Some(true) = only missing). `count_missing(drive_id)` catalog method + `remove_missing(drive_id) -> DpResult<u64>` (deletes media rows with `missing_at IS NOT NULL` for the drive, syncing FTS via the existing delete path; thumbs left on disk — consistent with FORGET).
- Modify: `crates/dp-catalog/src/query.rs`: honor `MediaQuery.missing`.
- Commands: `count_missing_media(drive_id)`, `remove_missing_media(drive_id)` in `src-tauri/src/commands/drives.rs` (or media.rs — follow file responsibility); register both.
- Frontend: `src/lib/api/media.ts` (+drives.ts) mirrors; GalleryPage passes `missing: false` by default and gains a toolbar chip "Missing (N)" (only rendered when N > 0 across drives — reuse a `["missing-count"]` query) toggling the grid to `missing: true`; `Tile` shows a small "MISSING" badge when `row.missing_at != null`; lightbox MetaPanel shows a one-line notice "File missing since <date> — deleted or moved outside drophoto" and disables Reveal in Finder. DriveCard dropdown gains "Remove missing… (N)" (only when N > 0) with a confirm dialog stating it removes catalog entries only, never files. Invalidate `["missing-count"]` in `onTerminalEvent`'s scan list.
- Tests: catalog (reconcile marks/clears/keeps first timestamp/scopes by source+drive; remove_missing deletes rows + FTS), scan integration (file deleted between scans → marked; restored → cleared; cancelled scan doesn't mark; errored source doesn't mark), query filter, frontend (chip visibility/toggle, badge, MetaPanel notice, remove flow with mockIPC).

Commit: `feat(scan): missing-file detection with gallery filter and catalog cleanup`.

### Task 5d.2: Sidecar health check

**Files:**
- Catalog: `sidecar_health(drive_id) -> SidecarHealth { tagged: u64, pending: u64 }` (tagged = media rows with ≥1 tag; pending = `sidecar_pending = 1`), dp-core type (Serialize).
- Command `sidecar_health(drive_id)`; command `check_sidecar_files(drive_id) -> u64`: for an ONLINE drive, stat `<file>.xmp` for every tagged row (bounded: existing rel_paths under the mount), count missing sidecar files, and set `sidecar_pending = 1` on those rows (repair queue) — read-only on disk, writes only the catalog flag. Then the existing sidecar sync job rewrites them.
- Frontend: Settings SIDECARS section (component folder `src/features/settings/components/SidecarsSection/`): per online drive — "N tagged · M pending"; buttons: "CHECK FILES" (runs check_sidecar_files, toasts "K sidecars missing — queued for rewrite" or "All sidecar files present"), "SYNC NOW" (existing `start_sidecar_sync_all`). Offline drives listed as "offline — plug in to check". Query keys `["sidecar-health", driveId]`, invalidated on sidecar job terminal events in `onTerminalEvent`.
- Tests: catalog counts; check command against a temp dir (present/missing sidecars, sets pending only for missing); section rendering/actions with mockIPC.

Commit: `feat(settings): sidecar health check with repair queue`.

### Task 5d.3: Cache location

**Files:**
- Catalog settings: `thumbs_dir: Option<String>` in `AppSettings` (settings key `thumbs_dir`, absent = default `<app-data>/thumbs`); `set_thumbs_dir(path: Option<String>)`.
- `src-tauri/src/state.rs`: resolve the thumbs root from settings at startup; if the configured dir does not exist/isn't readable, FALL BACK to the default and record a flag on AppState surfaced via `get_settings`-style command (`thumbs_dir_fallback: bool` in a new `CacheStatus` or added to the settings command response — pick one, document it) so Settings can warn "cache location unavailable — using default".
- Command `move_cache(new_dir)`: refuse while any job is running (reuse the admission/tracking state); refuse a destination inside any registered drive's SOURCE folder (photos must never mingle with cache) — a plain external-drive folder is allowed and is the point; create `<new_dir>/drophoto-thumbs`; move the current thumbs tree (fs::rename when same volume, else copy-then-delete per file, fsync'd); write the setting only after the move fully succeeds; return the new path. On any failure: leave the old tree authoritative, delete partial copies, return the error.
- Frontend: StorageSection gains a "Cache location" row: current path (truncated, title=full), CHANGE… button → folder picker (`@tauri-apps/plugin-dialog` open with directory: true — already a dependency), confirm dialog stating the app will relaunch; on success call `relaunchApp()` (existing updater API wrapper). Show the fallback warning when flagged.
- Tests: Rust move logic against temp dirs (same-volume rename path, failure leaves source intact, refuses source-folder destination, refuses while job running — unit-test the guard predicate); settings round-trip; frontend row/picker/confirm with mocked dialog + IPC.

Commit: `feat(settings): movable thumbnail cache location`.

### Task 5d.4: Organize template defaults

**Files:**
- Catalog: settings keys `default_root`, `default_folder_tpl`, `default_file_tpl`, `default_keep_pairs` with getters/setter (`get_organize_defaults() -> OrganizeDefaults`, `set_organize_defaults(...)`, dp-core type); `get_rule`'s None branch composes the default rule from these (falling back to the current hardcoded `OrganizeRule::default_for` values when unset).
- Commands `get_organize_defaults` / `set_organize_defaults` (validate templates via the existing `dp_organize::validate_template` + root validation reused from `commands::organize` — reject the same traversals/denied names).
- Frontend: Settings ORGANIZE DEFAULTS section (component folder): root + folder/file template inputs prefilled, keep-pairs toggle, SAVE with inline validation errors; a PRESETS dropdown with exactly: "Year / Month" (`{yyyy}/{mm}`), "Year / Quarter" (`{yyyy}/Q{q}`), "Flat by date" (`{yyyy}-{mm}-{dd}`) filling the folder template. The Organize wizard's rule editor gains the same presets dropdown (shared constants module).
- Tests: settings round-trip; get_rule fallback composes saved defaults; command validation rejects bad templates/roots; section save/validation + presets fill; wizard presets reuse.

Commit: `feat(organize): settings-backed default templates with presets`.

### Task 5d.5: Finalize

- Full gates: cargo fmt/clippy/test --workspace, pnpm lint/typecheck/test:coverage, `pnpm tauri build --debug --no-bundle`.
- Whole-branch review + ONE fix wave + scoped re-review. Extra scrutiny: the safety constraint (no disk writes to photos/sidecars anywhere new), reconcile correctness on cancelled/errored scans, move_cache failure atomicity.
- Bump 0.6.0 (stash dance), PR `Closes #35` titled `feat: missing files, sidecar health, cache location, template defaults (Phase 5d)`, squash-merge, release v0.6.0 via `scripts/release.sh` (eject any mounted drophoto DMGs first).
- Update memory + status artifact. Tell the user: the planned spec is now fully shipped; run a scan per drive once to populate missing-file state; "Later" bucket is next.
