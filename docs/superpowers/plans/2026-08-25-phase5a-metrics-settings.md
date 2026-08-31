# Phase 5a: Metrics, Storage & Thumbnail Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The user can see what every job cost (time, bytes read, thumbnails written, CPU), what the app's cache is consuming, and can trade preview quality for disk space; rescans of unchanged libraries become near-instant.

**Architecture:** A `job_runs` table written by the JobRunner via a `JobRecorder` trait (catalog implements it); jobs report byte counters through an extended `JobOutcome`. Incremental scan skips hash/exiftool/thumbs for files whose size+mtime match the catalog (new `media.mtime` column). The Settings screen (currently a stub) gains a storage section (computed on demand) and a 3-step preview-quality setting stored in the existing `settings` table; a `RegenJob` downscales existing 2000px previews offline from the cached WebPs.

**Tech Stack:** Rust (libc getrusage for CPU-seconds, walkdir for cache sizing), sqlx, React/TS.

**Spec:** `docs/superpowers/specs/2026-08-22-drophoto-design.md` §8 Phase 5 ("Settings & polish: …cache location, rescan/rehash…"); quality slider + metrics are user-requested additions (2026-08-25), recorded here as the authority.

## Global Constraints

- Same as prior phases: no `unwrap`/`expect` in non-test Rust; `DpError`; components never import `@tauri-apps/*`; component folders; TDD (real FS / in-memory catalog / mockIPC); pristine output; coverage holds.
- Local gates are the merge gate (NO CI): `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm tauri build --debug --no-bundle`.
- Commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Branch `feat/22-metrics-settings`. Controller pushes.
- Incremental skip must be SAFE: any doubt (missing thumb, mtime unreadable, size mismatch, quality changed) → full processing. Skipping must never lose sidecar-imported tags that a full pass would have caught — see 5a.2's sidecar rule.
- The quality setting affects PREVIEWS only (the 2000px slot); the 400px grid thumb is untouched everywhere.

---

### Task 5a.1: job_runs metrics (recorder + counters + UI)

**Files:**
- Create: `crates/dp-catalog/migrations/0008_job_runs.sql`, `crates/dp-catalog/src/job_runs.rs`
- Modify: `crates/dp-jobs/src/lib.rs` (`JobOutcome` counters, `JobRecorder` trait), `crates/dp-jobs/src/runner.rs` (record on terminal), `crates/dp-jobs/src/{scan.rs,sidecar_sync.rs,geocode.rs}` + `organize.rs`/`revert.rs` (fill counters where known), `crates/dp-hash` or scan's hash call site (bytes read = file size summed), `dp-thumbs` store (bytes written returned by `write`), `src-tauri/src/state.rs` (runner built `.with_recorder(catalog)`), commands (`list_job_runs`), `src/lib/api/metrics.ts`, `src/features/dashboard/**` (LAST RUNS card), `src/components/ActiveJobs` (rate + ETA)
- Test: `crates/dp-catalog/tests/job_runs.rs`, runner test, dashboard/ActiveJobs tests

**Interfaces:**
- Produces:

```sql
-- 0008_job_runs.sql
CREATE TABLE job_runs (
    id INTEGER PRIMARY KEY,
    job_id TEXT NOT NULL,            -- "scan-3"
    kind TEXT NOT NULL,              -- prefix: scan|organize|revert|sidecar|geocode
    drive_id INTEGER,                -- NULL for global jobs
    status TEXT NOT NULL,            -- done|cancelled|failed
    ok INTEGER NOT NULL, failed INTEGER NOT NULL, skipped INTEGER NOT NULL,
    bytes_read INTEGER NOT NULL DEFAULT 0,
    bytes_written INTEGER NOT NULL DEFAULT 0,
    cpu_ms INTEGER NOT NULL DEFAULT 0,      -- process rusage delta (user+sys)
    started_at TEXT NOT NULL, finished_at TEXT NOT NULL
);
```

```rust
// JobOutcome gains: pub bytes_read: u64, pub bytes_written: u64  (Default 0)
#[async_trait] pub trait JobRecorder: Send + Sync {
    async fn record_job_run(&self, run: NewJobRun) -> DpResult<()>;   // NewJobRun mirrors the table
}
// JobRunner::with_recorder(self, recorder: Arc<dyn JobRecorder>) -> Self
// runner.spawn(): capture started_at + rusage before run, on terminal build NewJobRun
//   (status from the event kind; drive_id parsed from… NOT parseable from id — jobs carry it:
//   spawn(id, job) can't know. Solution: `Job` trait gains `fn drive_id(&self) -> Option<i64> { None }`
//   default None; each job overrides. kind = id prefix before '-'.)
// cpu_ms: libc::getrusage(RUSAGE_SELF) delta — process-wide; documented as "app CPU during this job,
//   including concurrent jobs" (honest label, no false precision). Recorder errors: tracing::warn only.
```

- Counters: scan adds file size to `bytes_read` per hashed file and `ThumbStore::write`'s return to `bytes_written`; organize/revert leave 0 (renames); sidecar_sync counts sidecar bytes written; geocode 0.
- Command `list_job_runs(limit)` (cap 50) + TS `listJobRuns`; Dashboard "LAST RUNS" card: `SCAN Kodachrome · 16,032 files · 41m · 78.2 GB read · 2.6 GB thumbs · 6.5/s`; failures/cancelled marked. ActiveJobs strip: compute files/sec from the store's progress events (rolling window over last 30s of `done` deltas kept in the jobs store) and show `· 6.5/s · ~12m left` when `total > 0`.
- [ ] Steps: failing catalog tests (insert/list caps/order) → runner test (fake recorder captures a run with the right kind/status/tallies) → per-job counter tests (scan integration asserts bytes_read == sum of fixture sizes and bytes_written > 0) → UI tests → gates → commit `feat(metrics): per-job run metrics with dashboard and live rate`.

---

### Task 5a.2: incremental rescan

**Files:**
- Modify: `crates/dp-catalog/migrations/0008_job_runs.sql` (same migration adds `ALTER TABLE media ADD COLUMN mtime TEXT;`), `crates/dp-core/src/types.rs` (`MediaRow.mtime`, `NewMedia.mtime`), `crates/dp-catalog/src/media.rs` (persist + `list_scan_index(drive_id) -> Vec<(rel_path, size, mtime, id)>` — one query for the whole drive, loaded into a HashMap before the walk), `crates/dp-jobs/src/scan.rs`
- Test: `crates/dp-jobs/tests/scan.rs`

**Interfaces:**
- Skip rule, checked per walked file BEFORE hashing: known row for `rel_path` AND stored `size` == stat size AND stored `mtime` == stat mtime (RFC3339, second precision) AND `store.exists(hash, 400)` AND `store.exists(hash, preview slot)` → **skip** (no hash, no exiftool, no thumbs, no upsert; count `skipped`; progress advances). Any condition fails → full processing (which writes the new mtime).
- Sidecar rule for skipped files: if `sidecar_path` exists AND its mtime > the media row's stored `mtime` → still run the sidecar import for that row (cheap; catches Lightroom edits without a full pass). Otherwise nothing.
- Force full rescan: `start_scan` gains `full: bool` (default false); `full = true` ignores the skip index. UI: DriveCard's scan button stays incremental; add `FULL RESCAN` to the drive card's Sources dialog footer or an option chip — implementer picks the least intrusive spot, must be discoverable and tested.
- Prune of deleted files: files in the index but NOT seen by the walk are currently left as-is by scan (missing-file detection is later Phase 5 work) — unchanged here; document.
- [ ] Steps: failing tests — second scan of an unchanged fixture drive performs zero hashing (assert via a counting `Hasher` wrapper in ScanDeps) and finishes with `skipped == n`; touching one file's mtime re-processes exactly that file; a missing preview slot file re-processes (quality changes themselves are handled by RegenJob/full rescan, not the skip rule); sidecar-newer-than-row imports tags on a skipped file; `full: true` re-processes everything → implement → gates → commit `feat(scan): incremental rescan skips unchanged files`.

---

### Task 5a.3: Settings screen — storage section + preview quality

**Files:**
- Modify: `src/features/settings/SettingsPage.tsx` (replace stub; keep module.ts contract), `crates/dp-thumbs/src/lib.rs` (preview edge parametrized), `crates/dp-jobs/src/scan.rs` (reads edge from settings via deps), `src-tauri` new `commands/settings.rs` (`get_settings`, `set_preview_quality`, `storage_usage`, `start_regen_previews`), `crates/dp-catalog/src/settings.rs` (typed get/set over the existing `settings` table), `crates/dp-jobs/src/regen.rs` (RegenJob)
- Create: `src/features/settings/components/{StorageSection,QualityPicker}/…`, `src/lib/api/settings.ts`
- Test: alongside each

**Interfaces:**
- Quality steps (constants shared Rust↔TS by value): `compact` = 800px, `balanced` = 1200px, `max` = 2000px (default `max`, stored in `settings` key `preview_edge` as the integer). The 400px thumb is unaffected. `ThumbStore` filenames: keep `2000.webp` as the PREVIEW SLOT name regardless of edge (the slot is "the preview"; its pixel edge varies) — avoids renaming 16k files and breaking `preview_path`; document this in `dp-thumbs`.
- `storage_usage() -> { thumbs_400_bytes, previews_bytes, catalog_bytes, total_bytes, file_count }` — walkdir over the thumbs root summing by filename + catalog file size; runs in `spawn_blocking`; UI shows a breakdown bar + per-item rows and a REFRESH button (computed on open, not polled).
- `QualityPicker`: three labeled steps (radio-style segmented control, matches the flat UI) with estimated total («~2.6 GB» for max, scaled by (edge/2000)² for the others using the CURRENT previews_bytes) and copy: lowering quality frees space after REGENERATE PREVIEWS; raising it needs a FULL RESCAN with drives connected (originals required).
- **Danger zone — UNINSTALL / RESET**: a red-outlined section at the bottom of Settings with a `RESET APP DATA…` button → confirmation dialog stating exactly what happens ("Deletes the catalog and every cached thumbnail. Your photos, folders and .xmp sidecar files on your drives are NEVER touched.") requiring the user to type `RESET`; on confirm, command `reset_app_data` deletes `catalog.db*` and the `thumbs/` dir inside the app-data dir, then `std::process::exit(0)` (relaunch starts fresh); the dialog also notes "to fully uninstall, quit and drag drophoto to the Trash afterwards". Command unit-tested against a temp dir (never the real app-data path in tests).
- `RegenJob` (admission kind `"regen"`, global like geocode): iterates thumb store entries with a preview larger than the target edge (decode cached preview WebP → resize to target → re-encode → replace atomically via temp+rename); progress/cancel/tallies (`bytes_written` = new sizes; `bytes_read` = old). Only DOWNscaling — never upscales. Triggered by the settings button when the new edge < old; `set_preview_quality` returns whether a regen is applicable.
- [ ] Steps: failing settings-catalog tests (get/set round-trip, default) → thumbs param test (chain produces target edge into the preview slot) → RegenJob real-FS test (3 cached previews → downscaled in place, byte sizes shrink, 400px untouched) → storage_usage test (temp store with known files) → UI tests (storage rows render from mocked command; picker stages + applies; regen button fires and disabled states) → implement → gates → commit `feat(settings): storage usage and preview quality`.

---

### Task 5a.4: UI steadiness — toolbar count, live scan state on Drives (user field reports 2026-08-27)

**Files:**
- Modify: `src/features/gallery/components/GalleryToolbar/GalleryToolbar.tsx` (count span), `src/lib/jobs/jobsStore.ts` (+types), `src/features/drives/DrivesPage.tsx`
- Test: alongside each

**Interfaces:**
- Toolbar: the `{count} items` span gets `tabular-nums` and a stable reserved width (e.g. `inline-block min-w-[9ch] text-right`) so filter changes don't shift the toolbar. Test asserts the class.
- jobsStore gains `driveIds: Record<string, number>` + `setJobDrive(jobId, driveId)` (cleared with the job's entry on terminal via `clearFinished`); `DrivesPage` calls it in the scan mutation's `onSuccess` (alongside `setLabel`).
- `DrivesPage` derives each card's scan state from the GLOBAL store instead of its local `scanJobs` map (delete the local state): `scanEvent` = latest event of any active `scan-*` job whose `driveIds[jobId] === d.id`; `onCancelScan` uses that job id. Regression test: mount DrivesPage with a running scan already in the store (simulating navigate-away-and-back) → the card shows progress and CANCEL works.

- [ ] Steps: failing tests → implement → `pnpm lint && pnpm typecheck && pnpm test:coverage` → commit `fix(ui): steady toolbar count; drives page shows running scans after navigation`.

---

### Task 5a.5: drive presence — identity matching + forget drive (user field report 2026-08-27)

**Files:**
- Modify: `crates/dp-volumes/src/{lib.rs,presence.rs}` (Volume gains `uuid: Option<String>`; `SysinfoVolumes` fills it on macOS via `diskutil info -plist <mount>` parsing `VolumeUUID` — spawn per mounted volume, cache by mount path within the provider instance; non-macOS → None), `crates/dp-core/src/types.rs` (`Drive.volume_label: Option<String>` — migration 0008 adds the column), `crates/dp-catalog` (persist label+uuid at registration; `register_drive` captures the VOLUME's label and uuid, independent of the user's display name), `src-tauri/src/commands/drives.rs` (registration passes them; new `forget_drive` command), `src/features/drives` (Forget action)
- Test: presence unit tests + catalog tests + command/UI tests

**Interfaces:**
- **Root cause being fixed** (verified in code): `resolve_presence` matches `volume.name == drive.name`, but `drive.name` is the USER-CHOSEN display name; and the prior-mount-path fallback is empty once a drive is offline (`mount_path = None` was persisted). Reconnecting a renamed-at-registration drive therefore never matches and the volume shows up as "new".
- New matching order in `resolve_presence(drives, volumes)`: (1) `drive.volume_uuid == volume.uuid` (both Some), (2) `drive.volume_label == volume.name`, (3) legacy `drive.name == volume.name`, (4) prior mount path. First match wins; a volume already claimed by an earlier drive in the list must not match a second drive (track claimed volume indices). Registration back-fills `volume_uuid`+`volume_label` for the CURRENTLY-matched volume of legacy drives on every presence resolve when they're NULL (self-healing for the user's existing drive).
- Tests: renamed drive (display name ≠ label) reconnect matches by label; uuid beats label; two same-label volumes don't double-claim; legacy row self-heals uuid/label once online.
- **Forget drive**: command `forget_drive(drive_id)` — deletes the drive row and everything referencing it: sources (FK cascade or explicit), media rows (explicit delete including organize_items/organize_jobs for that drive first, media_tags via cascade, FTS rows via delete path), in ONE transaction; thumbnails are content-addressed and possibly shared across drives → left on disk (the Settings storage panel + a future GC own that; document). UI: `FORGET…` action on `DriveCard` (works offline — that's the point), confirmation dialog listing what goes ("removes N photos from the catalog and all their tags/places; files on the drive itself are never touched") requiring typed `FORGET`. Tests: catalog-level cascade test + dialog flow test.

- [ ] Steps: failing tests → implement → full gates → commit `feat(drives): volume identity matching, self-healing presence, forget drive`.

---

### Task 5a.6: Finalize

- [ ] Full gates; push; PR `Closes #22` titled `feat: job metrics, storage panel, preview quality, incremental rescan (Phase 5a)`; whole-branch review (opus) + one fix wave; merge; release v0.3.0 via `scripts/release.sh 0.3.0` (bump versions first); memory update.
