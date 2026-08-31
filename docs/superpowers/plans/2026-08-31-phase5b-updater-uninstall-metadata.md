# Phase 5b: In-App Updates, Uninstall, Metadata Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The installed app updates itself from GitHub Releases, can uninstall itself from Settings, and actually reads photo/video metadata (fixing the confirmed bug where all 16,200 exiftool and 150 ffmpeg invocations failed in the Finder-launched app because `/opt/homebrew/bin` is not on its PATH).

**Architecture:** (1) `tauri-plugin-updater` + `tauri-plugin-process` with updater artifacts (`.app.tar.gz` + `.sig`) signed by a local minisign-style keypair and a `latest.json` manifest served from the latest GitHub release; Settings gains an Updates section and startup does a silent check. (2) Uninstall reuses the reset-app-data internals and additionally moves the running `.app` bundle to the Trash before exiting. (3) A `resolve_tool` helper finds `exiftool`/`ffmpeg` at absolute paths (PATH, then Homebrew/MacPorts locations) at startup; migration 0009 adds `media.meta_read_at`; the incremental-scan skip path backfills metadata for rows that never had a successful read, without re-hashing or re-thumbnailing.

**Tech Stack:** Tauri 2 (`tauri-plugin-updater`, `tauri-plugin-process`), Rust workspace crates (dp-core, dp-catalog, dp-jobs, dp-metadata, dp-thumbs), sqlx SQLite migration 0009, React 19 + TS + TanStack Query, Vitest + mockIPC, `trash` crate (move-to-Trash), GitHub Releases via `gh`.

**Spec:** The user's prioritized request of 2026-08-31 (issue #24) + `docs/superpowers/specs/*phase*` §8 (Settings & polish). Diagnosis evidence: installed catalog at `~/Library/Application Support/com.ahmed.drophoto/catalog.db` has 17,395 media rows, 17,395 NULL `camera`, 17,268 NULL `taken_at`; `scan_errors` holds 16,200 × `exiftool: exiftool not found on PATH` and 150 × `ffmpeg: ffmpeg not found on PATH`.

## Global Constraints

- No `unwrap`/`expect` in non-test Rust; all errors `DpError`; components never import `@tauri-apps/*` (IPC and plugin calls go through `src/lib/api/*` wrappers); component folders `index.ts` + `.tsx` + `.types.ts`; TDD with real `SqliteCatalog::open_in_memory()` / mockIPC / `vi.mock`; pristine test output; coverage thresholds hold.
- Local gates are the merge gate (NO CI): `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, and for the finalize task `pnpm tauri build --debug --no-bundle`.
- Commit trailers: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and the session link trailer used on this branch. Branch `feat/24-updater-uninstall-metadata` (exists). Do not push; the controller pushes.
- Migration 0008 is FROZEN (shipped in v0.3.0). All new columns go in a new `0009_meta_read.sql`.
- SAFETY (absolute): nothing may ever delete or modify user photos, `.xmp` sidecars, or drive contents. Uninstall touches ONLY the app's own data dir and the app's own `.app` bundle (moved to Trash, not deleted). The dev-port edits in `src-tauri/tauri.conf.json` / `vite.config.ts` (localhost 1430/1431) stay uncommitted; when a task edits those files it must stage hunks so the port lines stay out of commits (stash → edit → commit → pop, as done for the 0.3.0 bump).
- The updater private key is NEVER committed. Only the public key goes in `tauri.conf.json`. Key generation happens in the finalize task via a script; the key file lives at `~/.tauri/drophoto_updater.key`.

---

### Task 5b.1: In-app updates

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `tauri-plugin-updater = "2"`, `tauri-plugin-process = "2"`), `src-tauri/src/lib.rs` (register both plugins), `src-tauri/tauri.conf.json` (`bundle.createUpdaterArtifacts: true`, `plugins.updater.endpoints` + placeholder `pubkey` — see Step 2; ports stay uncommitted), `src-tauri/capabilities/default.json` (or the existing capabilities file: add `updater:default`, `process:default`)
- Modify: `package.json` (add `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`)
- Create: `src/lib/api/updater.ts` + `src/lib/api/updater.test.ts` (thin wrapper: `checkForUpdate(): Promise<UpdateInfo | null>`, `downloadAndInstallUpdate(onProgress): Promise<void>`, `relaunchApp(): Promise<void>`; `UpdateInfo = { version: string; notes: string | null }`)
- Create: `src/features/settings/components/UpdatesSection/{index.ts,UpdatesSection.tsx,UpdatesSection.types.ts,UpdatesSection.test.tsx}`
- Create: `src/features/settings/hooks/useUpdater.ts` + test (state machine: idle → checking → upToDate | available(version, notes) → downloading(percent) → readyToRelaunch → error(message); auto-check once on mount of AppShell via a tiny effect component or inside JobEventsBridge init — pick ONE place, document it)
- Modify: `src/features/settings/SettingsPage.tsx` (+test) to render UpdatesSection first (top of page), `src/components/AppShell` or `JobEventsBridge` for the startup silent check + "Update available" toast (sonner, one toast per session, clicking navigates to `/settings`)
- Create: `scripts/updater-keygen.sh` (runs `pnpm tauri signer generate -w ~/.tauri/drophoto_updater.key`, prints the pubkey and backup instructions; idempotent — refuses to overwrite an existing key)
- Modify: `scripts/release.sh` (see below)

**Interfaces:**
- Produces (frontend): `useUpdater()` returning `{ status, version, notes, percent, check, install, relaunch, error }`; `UpdatesSection` props typed from it. Current app version comes from `getVersion()` (`@tauri-apps/api/app`) via the wrapper, shown as `Current: v0.4.0`.
- Produces (release pipeline): `scripts/release.sh` gains updater support: exports `TAURI_SIGNING_PRIVATE_KEY` from `~/.tauri/drophoto_updater.key` (and empty `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) before `pnpm tauri build`; after stapling it locates `target/release/bundle/macos/drophoto.app.tar.gz` + `.sig`, writes `latest.json` (`version`, `pub_date` RFC3339, `platforms.darwin-aarch64.{url,signature}` with url `https://github.com/AhmedFr/drophoto/releases/download/v$VERSION/drophoto.app.tar.gz` and signature = the `.sig` file CONTENT), and uploads DMG + `drophoto.app.tar.gz` + `latest.json` with `--clobber`. If the key file is missing, fail early with the keygen instruction.
- `plugins.updater.endpoints = ["https://github.com/AhmedFr/drophoto/releases/latest/download/latest.json"]`. `pubkey` is set to the placeholder string `"UPDATER_PUBKEY_TBD"` in this task; the finalize task replaces it with the real key after keygen (updater check errors gracefully with a placeholder — the UI must surface check errors as a quiet inline message, not a crash).

- [ ] Step 1: Failing tests for `useUpdater` (mock `src/lib/api/updater` with `vi.mock`): check→available flow, check→upToDate, install progress updates percent, error path surfaces message, auto-check triggers exactly once.
- [ ] Step 2: Implement wrapper + hook + UpdatesSection (states: "You're on the latest version", "vX available — Install", progress bar reusing the existing Progress component, "Restart to finish" button calling relaunch). Register plugins in Rust, capabilities, tauri.conf edits (`createUpdaterArtifacts: true`, endpoint, placeholder pubkey).
- [ ] Step 3: Startup silent check + toast wiring; test that a toast fires once when an update is available and never when up to date (mock wrapper).
- [ ] Step 4: `scripts/updater-keygen.sh` + `scripts/release.sh` changes (shellcheck-clean; keep `set -eu`).
- [ ] Step 5: All gates. Commit `feat(updater): in-app updates from GitHub releases` (stash-protect the port lines in tauri.conf.json).

---

### Task 5b.2: Uninstall from Settings

**Files:**
- Modify: `src-tauri/src/commands/settings.rs` (new `uninstall_app` command + `plan_uninstall` pure helper), `src-tauri/src/lib.rs` (register), `src-tauri/Cargo.toml` (add `trash = "5"`)
- Modify: `src/lib/api/settings.ts` (+test) — `uninstallApp(): Promise<void>`
- Create: `src/features/settings/components/UninstallDialog/{index.ts,UninstallDialog.tsx,UninstallDialog.types.ts,UninstallDialog.test.tsx}` (clone the ResetAppDataDialog pattern; typed word `UNINSTALL`; copy states exactly what happens: app moves to Trash, catalog + thumbnails deleted, photos and tag sidecar files untouched, drives keep their files)
- Modify: `src/features/settings/components/DangerZone/DangerZone.tsx` (+types/test) to host both actions (Reset app data, Uninstall)
- Modify: `src/features/settings/hooks/useSettingsData.ts` (+test) — `uninstall` mutation with surfaced error (same pattern as reset)

**Interfaces:**
- `uninstall_app` behavior, in order: (1) resolve the running bundle: `std::env::current_exe()` → the executable must be inside a path component ending in `.app` (walk ancestors to find the `.app` dir); if none (dev run), return `DpError::Unsupported { message: "not running from an installed .app bundle" }` — the UI shows this plainly; (2) delete app data using the SAME internals as reset (thumbs dir first, then `catalog.db*`), surfacing any error without exiting; (3) `trash::delete(app_bundle_path)` — to Trash, never a permanent delete; (4) `std::process::exit(0)`.
- `plan_uninstall(exe_path: &Path) -> Result<PathBuf, DpError>` is the pure, unit-testable part: returns the `.app` ancestor or the Unsupported error. Tests: exe inside `/Applications/drophoto.app/Contents/MacOS/drophoto` → returns the `.app` path; a bare `target/debug/drophoto` path → Unsupported; a nested `.app` inside another `.app` returns the INNERMOST ancestor containing the exe's `Contents/MacOS` (i.e. nearest `.app` ancestor).

- [ ] Step 1: Failing Rust tests for `plan_uninstall` (3 cases above). Failing TS tests: dialog typed-confirm gating, error surfaced, api round-trip (mockIPC).
- [ ] Step 2: Implement command + wrapper + dialog + DangerZone layout.
- [ ] Step 3: All gates. Commit `feat(settings): uninstall drophoto from the danger zone`.

---

### Task 5b.3: Metadata fix — tool resolution + backfill

**Files:**
- Create: `crates/dp-metadata/src/resolve.rs` (`pub fn resolve_tool(name: &str) -> Option<PathBuf>` — checks, in order: each dir in `$PATH`, then `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin`; returns the first existing executable file; pure w.r.t. an injected `&[PathBuf]` candidate list for tests, with a thin env-reading wrapper)
- Modify: `crates/dp-metadata/src/exiftool.rs` (`ExiftoolProvider::from_resolved()` using `resolve_tool("exiftool")`, falling back to bare `"exiftool"`), the ffmpeg call site in `crates/dp-thumbs` (same treatment for `ffmpeg`; check how the binary is invoked there and mirror it), `crates/dp-metadata/src/sidecar*.rs` if sidecar writing also shells to exiftool (it does — same resolved path)
- Modify: `src-tauri/src/state.rs` (build providers from resolved paths once; store `tool_health: ToolHealth { exiftool: Option<PathBuf>, ffmpeg: Option<PathBuf> }` on AppState), new command `tool_health` in `src-tauri/src/commands/settings.rs`, `src/lib/api/settings.ts` (+test)
- Create: `src/features/settings/components/ToolsSection/{index.ts,ToolsSection.tsx,ToolsSection.types.ts,ToolsSection.test.tsx}` — one row per tool: "exiftool — found at /opt/homebrew/bin/exiftool" or "missing — metadata will be empty; install with `brew install exiftool`" (red)
- Create: `crates/dp-catalog/migrations/0009_meta_read.sql` — `ALTER TABLE media ADD COLUMN meta_read_at TEXT;`
- Modify: `crates/dp-catalog/src/media.rs` + `lib.rs` (record `meta_read_at` on upsert when the scan's metadata read succeeded; new narrow `Catalog::update_media_metadata(id, &MediaMetadata, read_at)` that updates the metadata columns + `meta_read_at` and calls `sync_fts(id)` log-only), `ScanIndexEntry` gains `meta_read_at: Option<DateTime<Utc>>`
- Modify: `crates/dp-jobs/src/scan.rs` — upsert path: pass `meta_read_at = Some(now)` only when `deps.metadata.read` returned `Ok` (a defaulted-after-error row keeps NULL so it stays backfillable); skip path: when `find_skip_match` succeeds but `entry.meta_read_at.is_none()`, run `deps.metadata.read`; on `Ok` call `update_media_metadata` and count the file as `ok` (not `skipped`) since real work happened; on `Err` report the item error and leave `meta_read_at` NULL (retried next scan — the error is visible each scan, which is correct while the tool is missing)
- Test: `crates/dp-metadata/tests/resolve.rs` (candidate-list injection), extend `crates/dp-jobs/tests/scan.rs` (CountingHasher-style proof: a skip-eligible row with NULL `meta_read_at` gets exactly one metadata read and ZERO hashes/thumb renders; second scan does zero metadata reads; a row whose metadata read fails stays NULL and is retried; a genuinely-metadata-less file still gets `meta_read_at` set — no infinite retry), extend `crates/dp-catalog/tests` for `update_media_metadata` (fields land, FTS finds the new camera)

**Interfaces:**
- Consumes: 5a's `find_skip_match`/`ScanIndexEntry` (extend, keep fail-closed semantics untouched), `sync_fts`, settings command file from 5a.3/5b.2.
- Produces: `ToolHealth` serde struct (TS mirror in `src/lib/api/settings.ts`), `Catalog::update_media_metadata`.
- Upgrade story (documented in the task report): existing v0.3.0 rows all have NULL `meta_read_at` after 0009, so the next INCREMENTAL scan backfills EXIF for ~17k files (one exiftool run each, no re-hash, no re-thumb) and the 150 ffmpeg-failed videos re-process fully via the existing missing-thumb path.

- [ ] Step 1: Failing tests for `resolve_tool`, then implement + wire providers and `tool_health`.
- [ ] Step 2: Migration 0009 + catalog method + failing catalog tests → green.
- [ ] Step 3: Failing scan backfill tests (counting decorators) → implement skip-path backfill.
- [ ] Step 4: ToolsSection UI + tests.
- [ ] Step 5: All gates. Commit `fix(metadata): resolve exiftool/ffmpeg for bundled app, backfill metadata on rescan`.

---

### Task 5b.4: Finalize

- [ ] Full gates incl. `pnpm tauri build --debug --no-bundle`; whole-branch review + one fix wave (controller-driven); push; PR `Closes #24` titled `feat: in-app updates, uninstall, metadata fix (Phase 5b)`; merge.
- [ ] Keygen: run `scripts/updater-keygen.sh`, put the real pubkey in `tauri.conf.json` (committed — pubkey only), verify the private key file exists and REMIND the user to back it up.
- [ ] Bump versions to 0.4.0 (same stash-protect dance for the port lines), release `v0.4.0` via updated `scripts/release.sh` (now also uploads `drophoto.app.tar.gz` + `latest.json`).
- [ ] Tell the user: v0.3.0 → v0.4.0 is the LAST manual DMG install; from v0.4.0 the app self-updates. After installing, run a normal Scan on each drive to backfill metadata (needs the drive connected; progress visible; no re-hashing).
