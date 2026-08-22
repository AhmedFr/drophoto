# drophoto Phase 3 — Organize in place — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organize each drive in place — rename and file every catalogued photo/video into a date-based folder structure on the drive it lives on, with a full preview before anything moves, an auditable job log, and a Dashboard.

**Architecture:** New capability crate `dp-organize` (templates via `handlebars`, pure planner, `MoveStrategy` trait with `RenameStrategy` + `CopyVerifyDeleteStrategy` fallback) and an `OrganizeJob` on the existing `JobRunner`. Catalog gains `organize_rules`, `organize_jobs`, `organize_items`, `media.organized_at` (migration 0002). Frontend: `organize` feature = a 3-step wizard (Detect → Organize → Done) mirroring the design; `dashboard` feature reads jobs + drives. No files are copied; same-volume moves are atomic renames.

**Tech Stack:** Rust (handlebars 6, chrono, sqlx, blake3, tokio), Tauri 2, React 19/TS, TanStack Query, shadcn (Switch, Checkbox, RadioGroup), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-drophoto-design.md` (§1 pillar 2, §2 principle 3, §4.1 `MoveStrategy`, §6 organize tables, §7 Organize workflow, §8 Phase 3 row).

## Global Constraints

- macOS; pnpm; Rust workspace `crates/dp-*`; `src-tauri` wires only; `Arc<dyn Trait>` for capabilities; no `unwrap`/`expect` in non-test Rust; errors `{code,message,path?}`; blocking FS work in `spawn_blocking`.
- Frontend: components never import `@tauri-apps/*` (only `src/lib/api/*`); folder convention `index.ts`/`X.tsx`/`X.types.ts`/`X.test.tsx`; short files; coverage global 80/75, `src/lib/**` 90; TDD; test output pristine.
- **Data safety (spec §2.3):** never lose a file. Same volume → `fs::rename`. Cross-device error (`EXDEV`) → copy → blake3 verify → delete source. Never touch files the catalog doesn't know. Never overwrite an existing file (collision suffix). No trash folder. Every move logged old→new.
- Templates (exact defaults): root `archive`; folder `{{yyyy}}/Q{{q}}`; file `{{yyyy}}-{{mm}}-{{dd}}_{{stem}}`; variables `yyyy mm dd HH MM SS q stem ext` (q = quarter 1–4; `stem` = original filename without extension; `ext` lowercase without dot). Date source: `taken_at` → file mtime.
- Already organized = `media.organized_at IS NOT NULL` **or** `rel_path` starts with `<root>/`. Duplicate = another media row with the same hash already organized → `skipped_dup`.
- Drive roles are legacy: hide role from UI (register dialog no longer asks; default `archive` stays in the DB).
- Design tokens/classes as before; wizard visuals from the design: left step rail 262px with numbered marks, header eyebrow `STEP 01 · DETECT` + 34px title, footer bar 66px with `CANCEL`, progress `STEP 01 / 02`, `← BACK`, primary `CONTINUE →` / `ORGANIZE n →`; Done overlay with check box, `ORGANIZED`, `n photos filed`.
- SQLite: `max_connections(4)`, `busy_timeout(Duration::from_secs(5))`, WAL (file DB); in-memory test DB keeps `max_connections(1)`.
- Git: issue #7, branch `feat/7-organize`, conventional commits + trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`, PR, CI green, squash-merge.
- Always shippable: every task ends with `pnpm tauri dev` launching.

---

## File structure (end state)

```
crates/dp-core/src/types.rs           + OrganizeRule, OrganizeJobRow, OrganizeItemRow, OrganizePlanItem, PlanStatus, MediaRow.organized_at
crates/dp-catalog/migrations/0002_organize.sql
crates/dp-catalog/src/{sqlite.rs (pool opts), organize.rs}   Catalog + rule/jobs/items/unorganized queries
crates/dp-organize/src/{lib.rs, template.rs, planner.rs, strategy.rs}   NamingTemplate, plan(), MoveStrategy impls
crates/dp-organize/tests/{template.rs, planner.rs, strategy.rs}
crates/dp-jobs/src/organize.rs        OrganizeJob (+ tests/organize.rs)
src-tauri/src/commands/organize.rs    get_rule, save_rule, list_unorganized_summary, plan_organize, start_organize, list_jobs
src/lib/api/organize.ts(+.test.ts)    types + clients
src/lib/organize/groupPlan.ts(+.test.ts)   group plan items by folder for preview
src/features/organize/{OrganizePage.tsx, store/wizardStore.ts, components/{StepRail,WizardHeader,WizardFooter,DetectStep,SourceRow,OrganizeStep,PlanPreview,RuleEditor,DoneOverlay}/*}
src/features/dashboard/{DashboardPage.tsx, components/{StatTiles,RecentJobs,DriveCapacity}/*}
src/features/drives/components/RegisterDriveDialog   role toggle removed
```

---

### Task 3.1: Catalog — migration 0002, organize types, rules/jobs/items/unorganized queries, pool options

**Files:**
- Create: `crates/dp-catalog/migrations/0002_organize.sql`, `crates/dp-catalog/src/organize.rs`, `crates/dp-catalog/tests/organize.rs`
- Modify: `crates/dp-core/src/types.rs`, `crates/dp-catalog/src/{lib.rs,media.rs,sqlite.rs}`, `crates/dp-catalog/tests/media.rs` (fixture gets `organized_at`)

**Interfaces (produces):**
```rust
// dp-core
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct OrganizeRule { pub drive_id: i64, pub root: String, pub folder_tpl: String, pub file_tpl: String, pub keep_pairs: bool }
impl OrganizeRule { pub fn default_for(drive_id: i64) -> Self /* archive, {{yyyy}}/Q{{q}}, {{yyyy}}-{{mm}}-{{dd}}_{{stem}}, true */ }
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)] #[serde(rename_all="snake_case")]
pub enum PlanStatus { Planned, Moved, SkippedDup, SkippedCollision, Failed }
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct OrganizeJobRow { pub id: i64, pub drive_id: i64, pub drive_name: String, pub status: String /* running|done|cancelled|failed */, pub planned: u64, pub moved: u64, pub skipped: u64, pub failed: u64, pub started_at: DateTime<Utc>, pub finished_at: Option<DateTime<Utc>> }
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct OrganizeItemRow { pub id: i64, pub job_id: i64, pub media_id: i64, pub old_rel_path: String, pub new_rel_path: String, pub status: PlanStatus, pub error: Option<String> }
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct UnorganizedSummary { pub drive_id: i64, pub count: u64, pub bytes: u64, pub photos: u64, pub videos: u64, pub earliest: Option<DateTime<Utc>>, pub latest: Option<DateTime<Utc>> }
// MediaRow/NewMedia: + pub organized_at: Option<DateTime<Utc>> (NewMedia default None)
// Catalog trait additions
async fn get_rule(&self, drive_id: i64) -> DpResult<OrganizeRule>;        // default_for when absent
async fn save_rule(&self, r: &OrganizeRule) -> DpResult<()>;             // upsert
async fn list_unorganized(&self, drive_id: i64, root: &str) -> DpResult<Vec<MediaRow>>;  // organized_at IS NULL AND rel_path NOT LIKE '<root>/%'
async fn unorganized_summary(&self, drive_id: i64, root: &str) -> DpResult<UnorganizedSummary>;
async fn organized_hashes(&self, hashes: &[String]) -> DpResult<HashSet<String>>;       // hashes with any organized_at NOT NULL row (chunk IN lists by 500)
async fn create_organize_job(&self, drive_id: i64, planned: u64) -> DpResult<i64>;
async fn finish_organize_job(&self, id: i64, status: &str, moved: u64, skipped: u64, failed: u64) -> DpResult<()>;
async fn insert_organize_item(&self, item: &OrganizeItemRow) -> DpResult<i64>;          // id ignored on insert
async fn mark_media_organized(&self, media_id: i64, new_rel_path: &str) -> DpResult<()>; // sets rel_path + organized_at=now
async fn list_organize_jobs(&self, limit: u32) -> DpResult<Vec<OrganizeJobRow>>;         // newest first, joined drive name
async fn list_organize_items(&self, job_id: i64, limit: u32) -> DpResult<Vec<OrganizeItemRow>>;
```

- [ ] **Step 1: Migration** `0002_organize.sql`:
```sql
ALTER TABLE media ADD COLUMN organized_at TEXT;
CREATE INDEX media_drive_organized ON media(drive_id, organized_at);
CREATE TABLE organize_rules (drive_id INTEGER PRIMARY KEY REFERENCES drives(id) ON DELETE CASCADE, root TEXT NOT NULL, folder_tpl TEXT NOT NULL, file_tpl TEXT NOT NULL, keep_pairs INTEGER NOT NULL DEFAULT 1);
CREATE TABLE organize_jobs (id INTEGER PRIMARY KEY, drive_id INTEGER NOT NULL REFERENCES drives(id), status TEXT NOT NULL CHECK(status IN ('running','done','cancelled','failed')), planned INTEGER NOT NULL DEFAULT 0, moved INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, finished_at TEXT);
CREATE TABLE organize_items (id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES organize_jobs(id) ON DELETE CASCADE, media_id INTEGER NOT NULL, old_rel_path TEXT NOT NULL, new_rel_path TEXT NOT NULL, status TEXT NOT NULL, error TEXT);
CREATE INDEX organize_items_job ON organize_items(job_id);
```
- [ ] **Step 2: Types** in dp-core as above (+ `organized_at` on `MediaRow`/`NewMedia`; fix all constructors/tests across crates — `NewMedia { organized_at: None }`).
- [ ] **Step 3: Failing tests** `crates/dp-catalog/tests/organize.rs`: `get_rule_returns_default_then_saved`; `list_unorganized_excludes_organized_and_root_prefixed` (seed 3 rows: plain, `organized_at` set, `rel_path = "archive/x.jpg"` → only the plain one); `unorganized_summary_counts_bytes_kinds_and_range`; `organized_hashes_only_returns_organized`; `job_lifecycle` (create → insert 2 items → finish → `list_organize_jobs` shows counts + drive name, `list_organize_items` returns 2); `mark_media_organized_sets_path_and_timestamp`. Run → FAIL.
- [ ] **Step 4: Implement** `organize.rs` (+ `row_to_media` reads `organized_at`; `upsert_media` does not reset `organized_at` on conflict — add `organized_at = COALESCE(media.organized_at, excluded.organized_at)`). Wire trait. `sqlite.rs::open`: `.busy_timeout(Duration::from_secs(5))`, pool `max_connections(4)`; in-memory stays 1. Run → PASS.
- [ ] **Step 5: Gates + commit** `feat(catalog): organize rules, jobs, items, unorganized queries; pool tuning`.

---

### Task 3.2: `dp-organize` — templates, planner, move strategies

**Files:**
- Create: `crates/dp-organize/{Cargo.toml,src/lib.rs,src/template.rs,src/planner.rs,src/strategy.rs,tests/template.rs,tests/planner.rs,tests/strategy.rs}`

**Interfaces (produces):**
```rust
// template.rs
pub struct TemplateVars { pub taken: DateTime<Utc>, pub stem: String, pub ext: String }
pub trait NamingTemplate: Send + Sync { fn render(&self, tpl: &str, vars: &TemplateVars) -> DpResult<String>; }
pub struct HandlebarsTemplate; // strict mode; unknown var → DpError::Unsupported{message:"unknown template variable: x"}; output sanitized: path separators inside a rendered *segment* replaced by '-', no leading '.', trimmed
pub fn validate_template(tpl: &str) -> DpResult<()>; // renders with sample vars
// planner.rs
pub struct PlanInput<'a> { pub rule: &'a OrganizeRule, pub rows: &'a [MediaRow], pub organized_hashes: &'a HashSet<String>, pub existing_paths: &'a HashSet<String> /* rel paths already present on disk/catalog under root */, pub now: DateTime<Utc> }
pub struct OrganizePlanItem { pub media_id: i64, pub old_rel_path: String, pub new_rel_path: String, pub status: PlanStatus, pub reason: Option<String> }  // also in dp-core (serde) — define there, re-export
pub fn plan(input: &PlanInput, tpl: &dyn NamingTemplate, mtime: &dyn Fn(&MediaRow) -> Option<DateTime<Utc>>) -> DpResult<Vec<OrganizePlanItem>>;
// rules: date = taken_at or mtime(row) or `now`; new_rel_path = format!("{root}/{folder}/{file}.{ext}"); keep_pairs: rows sharing (parent dir, stem) get the same folder/file stem (use the earliest taken_at among the pair); duplicate hash in organized_hashes → SkippedDup; collision with existing_paths or another planned path → append `_1`, `_2`… before the extension (status stays Planned); identical old==new → SkippedCollision with reason "already in place".
// strategy.rs
#[async_trait] pub trait MoveStrategy: Send + Sync { async fn move_file(&self, from: &Path, to: &Path) -> DpResult<()>; }
pub struct RenameStrategy; // create_dir_all(to.parent) then fs::rename; if `to` exists → Err(Io "destination exists"); on EXDEV (raw_os_error 18) → delegate to CopyVerifyDeleteStrategy
pub struct CopyVerifyDeleteStrategy { pub hasher: Arc<dyn Hasher> } // copy (spawn_blocking), hash both, mismatch → remove copy + Err; match → remove source
pub fn default_strategy(hasher: Arc<dyn Hasher>) -> Arc<dyn MoveStrategy>;
```

- [ ] **Step 1: template tests then impl** — `renders_defaults` (`2025-09-12T14:03:21Z`, stem `IMG_4821`, ext `raf` with folder tpl → `2025/Q3`, file tpl → `2025-09-12_IMG_4821`), `quarter_boundaries` (Mar 31 → Q1, Apr 1 → Q2), `unknown_variable_errors`, `sanitizes_separators` (stem `a/b` → `a-b`), `validate_template_rejects_bad`. Deps: `handlebars = "6"`, `chrono`, `dp-core`, `dp-hash`, `async-trait`, `tokio`, `thiserror`.
- [ ] **Step 2: planner tests then impl** — `plans_paths_from_taken_at`; `falls_back_to_mtime_then_now`; `marks_duplicates`; `suffixes_collisions` (two rows rendering the same name → `_1`); `collision_with_existing_paths`; `pairs_share_stem_and_folder` (`DSCF0912.RAF` + `DSCF0912.JPG` in same dir, different taken_at by 2s → same folder, same new stem); `already_in_place_is_skipped`.
- [ ] **Step 3: strategy tests then impl** — temp dir: `rename_moves_and_creates_dirs`; `refuses_to_overwrite`; `copy_verify_delete_moves_when_rename_fails` (test the fallback struct directly; also a `RenameStrategy` with an injectable `rename_fn` in a `#[cfg(test)]`-only constructor returning an EXDEV error → falls back); `copy_verify_delete_keeps_source_on_mismatch` (inject a hasher that returns different digests → source still exists, destination removed).
- [ ] **Step 4: Gates + commit** `feat(organize): naming templates, planner and move strategies`.

---

### Task 3.3: `OrganizeJob` + Tauri commands + TS client

**Files:**
- Create: `crates/dp-jobs/src/organize.rs`, `crates/dp-jobs/tests/organize.rs`, `src-tauri/src/commands/organize.rs`, `src/lib/api/organize.ts`, `src/lib/api/organize.test.ts`
- Modify: `crates/dp-jobs/src/lib.rs`, `crates/dp-jobs/Cargo.toml`, `src-tauri/src/{state.rs,lib.rs,commands/mod.rs}`, `src-tauri/Cargo.toml`

**Interfaces:**
```rust
pub struct OrganizeDeps { pub catalog: Arc<dyn Catalog>, pub strategy: Arc<dyn MoveStrategy> }
pub struct OrganizeJob { .. } impl OrganizeJob { pub fn new(id: String, drive: Drive, job_row_id: i64, items: Vec<OrganizePlanItem>, deps: OrganizeDeps) -> Self }
// run: drive offline → Err(NotFound). For each item in order (sequential — moves are cheap; no concurrency): Planned → strategy.move_file(mount/old, mount/new) → mark_media_organized + insert item Moved; Err → insert Failed + ItemError + failed++; SkippedDup/SkippedCollision → insert as-is + skipped++; Progress after each. Cancel check before each item → cancelled=true; finish_organize_job(status = cancelled|done|failed(if any failed? no: done with failed count; "failed" only when run() errors)).
// commands (src-tauri)
get_rule(drive_id) -> OrganizeRule; save_rule(rule: OrganizeRule) -> (); (validate templates first → DpError::Unsupported)
list_unorganized_summaries() -> Vec<UnorganizedSummary>   // for every registered drive, using its rule.root
plan_organize(drive_ids: Vec<i64>) -> OrganizePlan { items: Vec<OrganizePlanItem>, planned: u64, skipped_dup: u64, in_place: u64, bytes: u64 }  // per drive: rule, list_unorganized, organized_hashes, existing_paths = rel_paths of media rows under root ∪ on-disk check skipped (catalog is the source of truth; strategy refuses overwrite anyway); mtime via std::fs::metadata on mount/rel_path inside spawn_blocking
start_organize(drive_id: i64) -> String  // re-plans for that drive, create_organize_job, spawns OrganizeJob id prefix "organize"; one active per drive (reuse active_scans pattern → rename map to active_jobs keyed by (kind, drive_id))
list_jobs(limit: u32) -> Vec<OrganizeJobRow>; list_job_items(job_id, limit) -> Vec<OrganizeItemRow>
```
TS mirrors: `OrganizeRule`, `PlanStatus`, `OrganizePlanItem`, `OrganizePlan`, `UnorganizedSummary`, `OrganizeJobRow`, `OrganizeItemRow`; `getRule`, `saveRule`, `listUnorganizedSummaries`, `planOrganize(driveIds)`, `startOrganize(driveId)`, `listJobs(limit)`, `listJobItems(jobId, limit)`.

- [ ] **Step 1: job tests** (`tests/organize.rs`, temp drive with `a.jpg`, `b.jpg`, `dup.jpg` (same bytes as a), catalog seeded via upsert): run → files exist at `archive/2025/Q3/2025-09-12_a.jpg` etc., originals gone, `media.rel_path` updated, `organized_at` set, dup row `skipped_dup` and its file untouched, `Finished{ok:2, skipped:1}`; cancel-before-start → `Cancelled`, no files moved; a planned item whose source file is missing → `Failed` item, job continues.
- [ ] **Step 2: implement job**, wire `AppState` (`strategy: Arc<dyn MoveStrategy>` from `default_strategy(hasher.clone())`), commands, TS client with mockIPC tests. Keep command bodies thin — planning helper `plan_for_drive(state, drive) -> DpResult<(OrganizeJobPlanParts)>` in `commands/organize.rs` is fine but must be < 120 lines; otherwise split `organize_plan.rs`.
- [ ] **Step 3: Gates + commit** `feat(organize): organize job, commands and API client`.

---

### Task 3.4: Organize wizard — Detect step

**Files:**
- Create: `src/features/organize/store/wizardStore.ts(+.test.ts)`, `src/features/organize/components/{StepRail,WizardHeader,WizardFooter,DetectStep,SourceRow}/*`, `src/features/organize/hooks/useUnorganized.ts`
- Modify: `src/features/organize/OrganizePage.tsx(+test)`, `src/features/drives/components/RegisterDriveDialog/*` (remove role toggle; always `"archive"`), `src/components/ui/{checkbox,switch,radio-group}.tsx` (shadcn add)

**Interfaces:** `useWizardStore` (not persisted): `step: 0 | 1`, `selectedDriveIds: number[]`, `toggleDrive`, `next`, `back`, `reset`. `DetectStep { summaries: (UnorganizedSummary & { drive: Drive })[]; selected; onToggle; onScan(driveId) }`. `SourceRow` = the design's source row (checkbox box, drive name, mount path, `n photos · m videos`, types, date range, size via `formatBytes`). Stat strip at top: `NEW PHOTOS FOUND` (sum selected), `DRIVES`, "…already organized photos are skipped" (count of organized rows = total − unorganized). Drives never scanned (count_media == 0) show a `SCAN NOW` button calling `startScan`.

- [ ] Tests: store transitions; DetectStep renders rows + totals, toggling updates store; OrganizePage shows step 01 header/eyebrow, footer `CONTINUE →` disabled with nothing selected. RegisterDriveDialog tests updated (no role).
- [ ] Gates (`pnpm tauri dev` shows the wizard) + commit `feat(organize): detect step with drive summaries; hide drive roles`.

---

### Task 3.5: Organize step — rule editor, plan preview, execute, done

**Files:**
- Create: `src/lib/organize/groupPlan.ts(+.test.ts)`, `src/features/organize/components/{OrganizeStep,PlanPreview,RuleEditor,DoneOverlay}/*`, `src/features/organize/hooks/{usePlan.ts,useOrganizeRun.ts}`
- Modify: `OrganizePage.tsx(+test)`, `wizardStore.ts`

**Interfaces:** `groupPlan(items: OrganizePlanItem[]): { folder: string; count: number; rows: OrganizePlanItem[] }[]` (folder = dirname of `new_rel_path`, sorted desc; rows limited to first 2 per folder + `more`). `RuleEditor { rule; onChange; onSave }` with root/folder/file inputs (mono), presets dropdown (`By quarter`, `By day`), `Keep RAW + JPEG pairs` Switch, live example line (`FORMAT … / FOLDERS …` box from the design rendered with a sample date). `PlanPreview { groups; skippedDup; inPlace }`. `useOrganizeRun`: starts `startOrganize` per selected drive sequentially, tracks job events via `useJobEvents`, exposes `running`, `done`, `totals`. `DoneOverlay { moved; folders: string[]; onOpenDrive; onDashboard }`.

- [ ] Tests: `groupPlan`; RuleEditor save calls `save_rule` with edited templates and re-plans; PlanPreview renders folders + `…and N more`; OrganizePage step 02: `ORGANIZE n →` runs, progress shown in footer (`MOVING 12 / 300`), DoneOverlay after `finished`; cancel button while running.
- [ ] Gates + commit `feat(organize): rule editor, plan preview, execute and done screen`.

---

### Task 3.6: Dashboard

**Files:** `src/features/dashboard/DashboardPage.tsx(+test)`, `components/{StatTiles,RecentJobs,DriveCapacity}/*`, `src/features/dashboard/hooks/useDashboard.ts`
- StatTiles: photos, videos, unorganized (sum of summaries), drives online/total. RecentJobs: `listJobs(10)` + scan jobs are not persisted → only organize jobs (status, drive, `moved/planned`, relative time). DriveCapacity: each drive with a capacity bar (`used/total`, online badge). Invalidate on `drives:changed` and on job `finished`.
- [ ] Tests per component with mockIPC; gates; commit `feat(dashboard): stats, recent jobs and drive capacity`.

---

### Task 3.7: PR — push, `gh pr create` (`Closes #7`), CI green → controller squash-merges.

## Self-review
- Spec §7 steps 1–5 ↔ 3.1 (counts/rules), 3.2 (plan, dups, collisions, pairs), 3.3 (execute, rename/fallback, log, cancel), 3.4/3.5 (UI), §8 Dashboard ↔ 3.6, pool ↔ 3.1, roles hidden ↔ 3.4. Types consistent: `OrganizePlanItem`/`PlanStatus` defined in dp-core, used by planner/job/commands/TS; `OrganizeRule` same everywhere; job id prefix `organize`.
