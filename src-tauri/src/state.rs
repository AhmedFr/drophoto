use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{CacheStatus, DpError, DpResult, ToolHealth};
use dp_hash::{Blake3Hasher, Hasher};
use dp_jobs::{Job, JobRunner};
use dp_metadata::{ExiftoolProvider, ExiftoolSidecars, MetadataProvider, Sidecars};
use dp_organize::{default_strategy, MoveStrategy};
use dp_places::{BundledGeocoder, Geocoder};
use dp_thumbs::{ThumbChain, ThumbStore};
use dp_volumes::{SysinfoVolumes, VolumeProvider};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{Emitter, Manager};
use tokio::sync::mpsc;

/// Capacity of the channel carrying `JobEvent`s from running jobs to the
/// task that re-emits them as Tauri `"job"` events.
const JOB_EVENT_CHANNEL_CAPACITY: usize = 256;

pub struct AppState {
    pub volumes: Arc<dyn VolumeProvider>,
    pub catalog: Arc<dyn Catalog>,
    pub hasher: Arc<dyn Hasher>,
    pub metadata: Arc<dyn MetadataProvider>,
    pub thumbs: Arc<ThumbChain>,
    pub store: Arc<ThumbStore>,
    pub sidecars: Arc<dyn Sidecars>,
    pub strategy: Arc<dyn MoveStrategy>,
    pub geocoder: Arc<dyn Geocoder>,
    pub runner: JobRunner,
    /// The current user's home directory (`$HOME`), resolved once at
    /// startup and reused by every command that needs it (the scan and
    /// source-detection walks, for the deny-list's `home/Library` rule —
    /// see [`dp_core::denylist::is_denied_path`]). `None` when `$HOME`
    /// isn't set, which is logged once here rather than on every command
    /// invocation.
    pub home: Option<PathBuf>,
    /// Job id of the in-flight job for each `(kind, drive_id)` pair,
    /// where `kind` is `"scan"` or `"organize"`. A drive may have at most
    /// one running job *of any kind* at a time — see [`job_admission`].
    /// Stale entries (a job that finished or was cancelled) are pruned
    /// lazily the next time [`AppState::start_scan`]/
    /// [`AppState::start_organize`] checks them against
    /// [`JobRunner::is_running`].
    active_jobs: Mutex<HashMap<(String, i64), String>>,
    /// The app's own data directory (`tauri::path::BaseDirectory::AppData`)
    /// — where `catalog.db` (plus its `-wal`/`-shm` siblings) and the
    /// `thumbs/` directory live. Resolved once at startup and reused by
    /// `storage_usage` and `reset_app_data`, rather than re-querying
    /// `AppHandle::path()` on every call.
    pub app_data_dir: PathBuf,
    /// Where `exiftool`/`ffmpeg` were found at startup — the same
    /// resolution the providers above were built with, snapshotted once
    /// so the `tool_health` command can show it in Settings without
    /// re-probing the filesystem on every call.
    pub tool_health: ToolHealth,
    /// The thumbnail-cache root actually in use this launch, plus whether
    /// it's a fallback from an unusable configured location (e.g. a cache
    /// on an external drive that isn't plugged in) — resolved once here
    /// and served verbatim by the `cache_status` command. `store` above
    /// was built from this same resolution, so the two can never disagree.
    pub cache_status: CacheStatus,
    /// `true` while `move_cache` is relocating the thumbs tree — job
    /// admission refuses every new job for that window (see
    /// [`AppState::begin_cache_move`]), so nothing can start writing into
    /// the tree being moved out from under it.
    cache_moving: std::sync::atomic::AtomicBool,
}

/// RAII guard from [`AppState::begin_cache_move`]: clears the
/// move-in-flight flag on drop, so an early return or error inside
/// `move_cache` can never leave job admission wedged shut.
pub struct CacheMoveGuard<'a> {
    state: &'a AppState,
}

impl Drop for CacheMoveGuard<'_> {
    fn drop(&mut self) {
        self.state
            .cache_moving
            .store(false, std::sync::atomic::Ordering::SeqCst);
    }
}

impl AppState {
    pub async fn init(app: &tauri::AppHandle) -> DpResult<Self> {
        let dir = app.path().app_data_dir().map_err(|e| DpError::Io {
            message: e.to_string(),
            path: None,
        })?;
        std::fs::create_dir_all(&dir).map_err(|e| DpError::io(&e, dir.display().to_string()))?;
        let db_path = dir.join("catalog.db");
        let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open(&db_path).await?);

        // The cache may have been relocated (Settings → Cache location).
        // A configured dir that's missing or unreadable — most likely a
        // cache on an external drive that isn't plugged in right now —
        // falls back to the default for this launch WITHOUT clearing the
        // setting, so plugging the drive back in and relaunching restores
        // it. `fallback` tells Settings to warn about the substitution.
        let default_thumbs = dir.join("thumbs");
        let configured = catalog.get_settings().await?.thumbs_dir;
        let (thumbs_root, fallback) = resolve_thumbs_root(default_thumbs, configured.as_deref());
        std::fs::create_dir_all(&thumbs_root)
            .map_err(|e| DpError::io(&e, thumbs_root.display().to_string()))?;
        let cache_status = CacheStatus {
            thumbs_dir: thumbs_root.display().to_string(),
            fallback,
        };

        // The static `assetProtocol.scope` in `tauri.conf.json` only covers
        // the default `$APPDATA/thumbs/**` location, resolved once at build
        // time. When Settings → Cache location relocates the thumbs root
        // outside `$APPDATA` (see `commands::settings::move_cache`), the
        // webview's `asset:` protocol (`convertFileSrc`, used for every
        // thumbnail/preview) would 403 everything under the new root unless
        // we also register the *actually resolved* root here at runtime —
        // this is in addition to, not instead of, the static config scope,
        // which still covers the unmoved default case.
        if let Err(e) = app.asset_protocol_scope().allow_directory(&thumbs_root, true) {
            tracing::warn!(
                "failed to register {} in the asset protocol scope: {e}",
                thumbs_root.display()
            );
        }

        let (tx, mut rx) = mpsc::channel(JOB_EVENT_CHANNEL_CAPACITY);
        let runner = JobRunner::new(tx).with_recorder(catalog.clone());

        let events_app = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(ev) = rx.recv().await {
                if let Err(e) = events_app.emit("job", &ev) {
                    tracing::warn!("failed to emit job event: {e}");
                }
            }
        });

        let hasher: Arc<dyn Hasher> = Arc::new(Blake3Hasher);

        let home = std::env::var_os("HOME").map(PathBuf::from);
        if home.is_none() {
            tracing::warn!("$HOME is not set; the home/Library deny-list rule will be skipped");
        }

        let geocoder: Arc<dyn Geocoder> = Arc::new(BundledGeocoder::load()?);

        // Resolved once: a Finder-launched bundle's PATH has no
        // /opt/homebrew/bin, so the bare command names the providers used
        // to spawn failed on every call in the installed app (Task 5b.3).
        let tool_health = ToolHealth {
            exiftool: dp_metadata::resolve_tool("exiftool"),
            ffmpeg: dp_metadata::resolve_tool("ffmpeg"),
        };

        Ok(Self {
            volumes: Arc::new(SysinfoVolumes::default()),
            catalog,
            strategy: default_strategy(hasher.clone()),
            hasher,
            metadata: Arc::new(ExiftoolProvider::from_resolved()),
            thumbs: Arc::new(ThumbChain::resolved_chain()),
            store: Arc::new(ThumbStore::new(thumbs_root)),
            sidecars: Arc::new(ExiftoolSidecars::from_resolved()),
            geocoder,
            runner,
            home,
            active_jobs: Mutex::new(HashMap::new()),
            app_data_dir: dir,
            tool_health,
            cache_status,
            cache_moving: std::sync::atomic::AtomicBool::new(false),
        })
    }

    /// Whether ANY tracked job — per-drive or global sweep — is still
    /// actually running. `move_cache` refuses while this is true: a scan
    /// or regen writing thumbnails mid-move would land files in a tree
    /// that's about to be deleted.
    pub fn any_job_running(&self) -> bool {
        let jobs = lock_active_jobs(&self.active_jobs);
        jobs.values().any(|job_id| self.runner.is_running(job_id))
    }

    /// Marks a cache move as in flight for the duration of the returned
    /// guard — while set, [`Self::start_job_as`] refuses every new job.
    /// Closes the other half of the move/job race: `any_job_running`
    /// keeps a move from starting under a job, this keeps a job from
    /// starting under a move.
    pub fn begin_cache_move(&self) -> CacheMoveGuard<'_> {
        self.cache_moving.store(true, std::sync::atomic::Ordering::SeqCst);
        CacheMoveGuard { state: self }
    }

    /// Starts a scan for `drive_id`, unless a job is already running for
    /// it — in which case the existing scan's id is returned instead of
    /// starting a duplicate, or an error if the running job is of a
    /// *different* kind (see [`job_admission`]). `make_job` builds the
    /// [`Job`] given the id it will run under.
    pub fn start_scan(
        &self,
        drive_id: i64,
        make_job: impl FnOnce(String) -> Arc<dyn Job>,
    ) -> DpResult<String> {
        self.start_job("scan", drive_id, make_job)
    }

    /// Starts an organize job for `drive_id`, unless a job is already
    /// running for it — in which case the existing organize job's id is
    /// returned instead of starting a duplicate, or an error if the
    /// running job is of a *different* kind (see [`job_admission`]).
    /// `make_job` builds the [`Job`] given the id it will run under.
    pub fn start_organize(
        &self,
        drive_id: i64,
        make_job: impl FnOnce(String) -> Arc<dyn Job>,
    ) -> DpResult<String> {
        self.start_job("organize", drive_id, make_job)
    }

    /// Starts a sidecar-sync job for `drive_id`, unless a job is already
    /// running for it — in which case the existing sync's id is returned
    /// instead of starting a duplicate, or an error if the running job is
    /// of a *different* kind (see [`job_admission`]). `make_job` builds
    /// the [`Job`] given the id it will run under.
    pub fn start_sidecar_sync(
        &self,
        drive_id: i64,
        make_job: impl FnOnce(String) -> Arc<dyn Job>,
    ) -> DpResult<String> {
        self.start_job("sidecar", drive_id, make_job)
    }

    /// Starts a reverse-geocode sweep, unless one is already running — in
    /// which case its id is returned instead of starting a duplicate.
    ///
    /// Unlike every other `start_*` method here, a [`dp_jobs::GeocodeJob`]
    /// is GLOBAL — one sweep covers every drive's media in a single run —
    /// so there is no real `drive_id` to admit it under. It's tracked
    /// under the sentinel drive id `0` instead: no real drive ever has
    /// this id (SQLite's `INTEGER PRIMARY KEY` autoincrement starts real
    /// drive ids at `1`), so [`job_admission`]'s per-`(kind, drive_id)`
    /// bucketing has the effect of serializing geocode sweeps globally
    /// (at most one running at a time, app-wide) while never blocking, or
    /// being blocked by, any per-drive job — those are all tracked under
    /// their own real drive ids and never collide with `0`.
    pub fn start_geocode(&self, make_job: impl FnOnce(String) -> Arc<dyn Job>) -> DpResult<String> {
        self.start_job("geocode", 0, make_job)
    }

    /// Starts the preview-regen sweep, unless one is already running — in
    /// which case its id is returned instead of starting a duplicate.
    ///
    /// Same sentinel-`drive_id`-`0` convention as [`Self::start_geocode`]
    /// (see its doc comment): a [`dp_jobs::RegenJob`] is GLOBAL, so it's
    /// tracked under a `"regen"` bucket at drive id `0` rather than a real
    /// drive. That also means a regen sweep and a geocode sweep block each
    /// other (both occupy drive id `0`, under different kinds) — an
    /// acceptable trade rather than a deliberate one: it keeps at most one
    /// global background job running at a time, same as every per-drive
    /// job already only allows one job per drive.
    pub fn start_regen(&self, make_job: impl FnOnce(String) -> Arc<dyn Job>) -> DpResult<String> {
        self.start_job("regen", 0, make_job)
    }

    /// Starts a revert job for `drive_id`, admitted under the exact same
    /// `"organize"` bucket as [`Self::start_organize`] — a scan, an
    /// organize, and a revert are mutually exclusive on a drive. Unlike
    /// `start_organize`/`start_scan`, this is `exclusive`: *any* other
    /// job already running for this drive — whether it's a different
    /// kind (blocked, same as always) or, critically, another job under
    /// this very `"organize"` bucket (an organize job, or someone else's
    /// revert) — refuses outright with a generic message, rather than
    /// reusing that other job's id. Reverting job A must never silently
    /// hand back the id of an in-flight revert of job B; the caller asked
    /// to revert a *specific* job, and a job id for anything else is
    /// simply wrong, not a helpful dedupe.
    pub fn start_revert(
        &self,
        drive_id: i64,
        make_job: impl FnOnce(String) -> Arc<dyn Job>,
    ) -> DpResult<String> {
        self.start_job_as("organize", "revert", true, drive_id, make_job)
    }

    /// Returns the running job id for `(kind, drive_id)`, if any, without
    /// starting anything. Lets a caller skip redundant work (e.g.
    /// re-planning an organize job) up front when it already knows the
    /// spawn itself would just be deduped.
    pub fn active_job(&self, kind: &str, drive_id: i64) -> Option<String> {
        let jobs = lock_active_jobs(&self.active_jobs);
        let job_id = jobs.get(&(kind.to_string(), drive_id))?;
        self.runner.is_running(job_id).then(|| job_id.clone())
    }

    /// A read-only preview of what [`Self::start_job`] would do for a
    /// non-exclusive `kind` job on `drive_id` right now — built from the
    /// exact same [`job_admission`]/[`resolve_admission`] pair `start_job`
    /// itself uses, so it can never disagree with the real decision made a
    /// moment later. `None` means it would actually spawn (not a
    /// guarantee — a concurrent call could still race in before the real
    /// `start_job` runs, same as always); `Some` carries the id to reuse
    /// or the refusal `start_job` would produce.
    ///
    /// Lets a command bail out of expensive prep work it would just throw
    /// away on a deduped or refused call — e.g. `start_scan` building its
    /// ~16k-row skip index before knowing whether the scan will even run
    /// (review finding 10) — before doing anything else.
    pub fn precheck(&self, kind: &str, drive_id: i64) -> Option<DpResult<String>> {
        let jobs = lock_active_jobs(&self.active_jobs);
        let decision = job_admission(&jobs, kind, drive_id, |id| self.runner.is_running(id));
        precheck_resolution(resolve_admission(decision, kind, false, drive_id))
    }

    /// Starts a `kind` job ("scan" or "organize") for `drive_id`: reuses
    /// the running job's id if one of the same kind is already active,
    /// refuses with [`DpError::Unsupported`] if a job of a *different*
    /// kind is active for this drive, or spawns a new one otherwise. See
    /// [`job_admission`] for the underlying decision.
    ///
    /// The check-and-insert happens under a single lock acquisition so two
    /// concurrent calls for the same drive can't both observe "nothing
    /// running" and each spawn their own job.
    fn start_job(
        &self,
        kind: &str,
        drive_id: i64,
        make_job: impl FnOnce(String) -> Arc<dyn Job>,
    ) -> DpResult<String> {
        self.start_job_as(kind, kind, false, drive_id, make_job)
    }

    /// [`Self::start_job`], but with the freshly spawned job's id prefix
    /// (`id_prefix`) decoupled from the admission bucket it's tracked
    /// under (`admission_kind`), and `exclusive` controlling how
    /// [`Admission::Existing`] is handled — see [`Self::start_revert`],
    /// the only caller that needs either to differ from `start_job`'s
    /// defaults.
    fn start_job_as(
        &self,
        admission_kind: &str,
        id_prefix: &str,
        exclusive: bool,
        drive_id: i64,
        make_job: impl FnOnce(String) -> Arc<dyn Job>,
    ) -> DpResult<String> {
        if self.cache_moving.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(DpError::Unsupported {
                message: "the thumbnail cache is being moved — try again when it finishes".into(),
                path: None,
            });
        }
        let mut jobs = lock_active_jobs(&self.active_jobs);
        let decision = job_admission(&jobs, admission_kind, drive_id, |id| self.runner.is_running(id));

        match resolve_admission(decision, id_prefix, exclusive, drive_id) {
            Resolution::Reuse(job_id) => Ok(job_id),
            Resolution::Refuse(message) => Err(DpError::Unsupported { message, path: None }),
            Resolution::Spawn => {
                let job_id = self.runner.next_id(id_prefix);
                self.runner.spawn(job_id.clone(), make_job(job_id.clone()));
                jobs.insert((admission_kind.to_string(), drive_id), job_id.clone());
                Ok(job_id)
            }
        }
    }
}

/// The outcome of deciding whether a new `kind` job may start for
/// `drive_id`, given the currently-tracked `active` jobs.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Admission {
    /// No job (of any kind) is currently running for this drive — go
    /// ahead and spawn.
    Start,
    /// A job of the *same* kind is already running — reuse its id rather
    /// than starting a duplicate.
    Existing(String),
    /// A job of a *different* kind is already running — refuse; a drive
    /// may only have one job (of any kind) running at a time.
    Blocked { other_kind: String },
}

/// Pure decision function behind [`AppState::start_job`]: given the
/// currently-tracked `active` jobs and an `is_running` check (so the
/// caller can distinguish a merely-stale tracked id from one still
/// actually running), decides whether a `kind` job may start for
/// `drive_id`.
fn job_admission(
    active: &HashMap<(String, i64), String>,
    kind: &str,
    drive_id: i64,
    is_running: impl Fn(&str) -> bool,
) -> Admission {
    if let Some(job_id) = active.get(&(kind.to_string(), drive_id)) {
        if is_running(job_id) {
            return Admission::Existing(job_id.clone());
        }
    }

    for ((other_kind, other_drive_id), job_id) in active {
        if *other_drive_id == drive_id && other_kind != kind && is_running(job_id) {
            return Admission::Blocked {
                other_kind: other_kind.clone(),
            };
        }
    }

    Admission::Start
}

/// What [`AppState::start_job_as`] should actually do, given a
/// [`job_admission`] decision.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Resolution {
    /// Spawn a new job.
    Spawn,
    /// Reuse this already-running job's id rather than spawning.
    Reuse(String),
    /// Refuse with this message.
    Refuse(String),
}

/// Turns a [`job_admission`] decision into a [`Resolution`], given the
/// id prefix *this* caller would spawn under (`id_prefix`) and whether
/// it wants [`Admission::Existing`] treated as a dedupe-and-reuse at all
/// (`exclusive`).
///
/// `Admission::Existing` is only ever a `Reuse` when *both* hold: not
/// `exclusive`, and the existing job's id actually starts with
/// `id_prefix`. That second condition is what makes an in-flight revert
/// block a *new* organize the same way any other job would: the
/// `"organize"` admission bucket now holds both `"organize-N"` and
/// `"revert-N"` ids (see [`AppState::start_revert`]), so an `Existing`
/// hit there is only really "the same kind of thing, dedupe it" when the
/// id itself agrees — an `"organize"` caller finding a `"revert-N"` job
/// already running must refuse, not silently start organizing (or reuse
/// a revert's id as if it were its own). `exclusive` (revert's own case)
/// refuses `Existing` unconditionally, prefix match or not — see
/// `start_revert`'s doc comment for why.
///
/// `exclusive` additionally changes the *message* on `Blocked` — a
/// specific "a {kind} job is already running" everywhere else, or the
/// generic message revert wants for either sub-case.
///
/// `drive_id` is only consulted for its wording, not the decision itself
/// (that's entirely `job_admission`'s call): the sentinel `0` identifies
/// a GLOBAL job (geocode/regen — see `AppState::start_geocode`/
/// `start_regen`), for which "on this drive" is nonsense — there's no
/// drive to name. No real drive ever has id `0` (SQLite's `INTEGER
/// PRIMARY KEY` autoincrement starts at `1`), so this can't misfire on
/// an actual per-drive job.
fn resolve_admission(decision: Admission, id_prefix: &str, exclusive: bool, drive_id: i64) -> Resolution {
    const GENERIC_CONFLICT: &str = "another job is running on this drive";
    const SIDECAR_CONFLICT: &str =
        "a background sidecar sync is finishing on this drive — try again in a moment";
    let is_global = drive_id == 0;

    match decision {
        Admission::Start => Resolution::Spawn,
        Admission::Existing(job_id) => {
            if !exclusive && job_id.starts_with(&format!("{id_prefix}-")) {
                Resolution::Reuse(job_id)
            } else {
                Resolution::Refuse(GENERIC_CONFLICT.into())
            }
        }
        Admission::Blocked { other_kind } => {
            if exclusive {
                Resolution::Refuse(GENERIC_CONFLICT.into())
            } else if other_kind == "sidecar" {
                // A sidecar sync is the one job kind the user never
                // started — it's a background sweep triggered by their
                // own tag edits. Naming it the way the other kinds are
                // named ("a sidecar job is already running") reads like
                // they did something wrong, and says nothing about what
                // to do. It's also always short, so say that instead.
                Resolution::Refuse(SIDECAR_CONFLICT.into())
            } else if is_global {
                // Two global sweeps (geocode, regen) serialize under the
                // same drive-0 bucket — see `start_regen`'s doc comment.
                // Neither is "on this drive".
                Resolution::Refuse(format!("a {other_kind} sweep is already running"))
            } else {
                Resolution::Refuse(format!("a {other_kind} job is already running on this drive"))
            }
        }
    }
}

/// Turns a [`Resolution`] into what [`AppState::precheck`] returns to its
/// caller — factored out as a pure function so it's unit-testable without
/// a real `AppState`. `Spawn` means "nothing to report, go ahead and do
/// the expensive prep work"; `Reuse`/`Refuse` are exactly what the real
/// `start_job` call would produce a moment later.
fn precheck_resolution(resolution: Resolution) -> Option<DpResult<String>> {
    match resolution {
        Resolution::Spawn => None,
        Resolution::Reuse(job_id) => Some(Ok(job_id)),
        Resolution::Refuse(message) => Some(Err(DpError::Unsupported { message, path: None })),
    }
}

/// Locks `active_jobs`, recovering from mutex poisoning instead of
/// unwrapping — the guarded section is a trivial `HashMap` lookup/insert
/// that can't leave the map in a state worth propagating a poisoned-lock
/// panic for.
fn lock_active_jobs(
    active_jobs: &Mutex<HashMap<(String, i64), String>>,
) -> MutexGuard<'_, HashMap<(String, i64), String>> {
    active_jobs
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Resolves which thumbs root this launch uses: the configured relocation
/// when it's usable, else `default_thumbs` (flagging the fallback).
/// A configured path is only ever adopted when its leaf directory is
/// literally named `drophoto-thumbs` — the name `move_cache` always
/// creates — so a hand-edited or corrupted setting pointing at an
/// arbitrary folder (say, a Pictures directory) is never adopted as a
/// cache root the app would later treat as its own to delete.
fn resolve_thumbs_root(default_thumbs: PathBuf, configured: Option<&str>) -> (PathBuf, bool) {
    match configured {
        Some(configured) => {
            let p = PathBuf::from(configured);
            if !is_cache_shaped(&p) {
                tracing::warn!(
                    "configured thumbs dir {configured} is not a drophoto-thumbs directory; ignoring it"
                );
                (default_thumbs, true)
            } else if p.is_dir() {
                (p, false)
            } else {
                tracing::warn!(
                    "configured thumbs dir {configured} is unavailable; using the default for this launch"
                );
                (default_thumbs, true)
            }
        }
        None => (default_thumbs, false),
    }
}

/// Whether `path`'s leaf is the directory name `move_cache` always
/// creates — the structural marker separating "a cache root this app
/// made" from "some arbitrary folder a bad setting points at". Shared by
/// startup adoption ([`resolve_thumbs_root`]) and the reset path's
/// deletion of a configured-but-inactive cache (`commands::settings`).
pub fn is_cache_shaped(path: &std::path::Path) -> bool {
    path.file_name().is_some_and(|n| n == "drophoto-thumbs")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(entries: &[(&str, i64, &str)]) -> HashMap<(String, i64), String> {
        entries
            .iter()
            .map(|(kind, drive_id, job_id)| ((kind.to_string(), *drive_id), job_id.to_string()))
            .collect()
    }

    #[test]
    fn admits_start_when_nothing_is_tracked_for_the_drive() {
        let active = map(&[]);
        assert_eq!(job_admission(&active, "scan", 1, |_| true), Admission::Start);
    }

    #[test]
    fn admits_start_when_a_tracked_entry_is_stale() {
        let active = map(&[("scan", 1, "scan-0")]);
        assert_eq!(job_admission(&active, "scan", 1, |_| false), Admission::Start);
    }

    #[test]
    fn reuses_the_existing_id_for_a_running_job_of_the_same_kind() {
        let active = map(&[("scan", 1, "scan-0")]);
        assert_eq!(
            job_admission(&active, "scan", 1, |_| true),
            Admission::Existing("scan-0".into())
        );
    }

    #[test]
    fn blocks_a_different_kind_when_one_is_already_running() {
        let active = map(&[("scan", 1, "scan-0")]);
        assert_eq!(
            job_admission(&active, "organize", 1, |_| true),
            Admission::Blocked {
                other_kind: "scan".into()
            }
        );
    }

    #[test]
    fn does_not_block_on_a_different_drive() {
        let active = map(&[("scan", 2, "scan-0")]);
        assert_eq!(job_admission(&active, "organize", 1, |_| true), Admission::Start);
    }

    #[test]
    fn a_stale_other_kind_entry_does_not_block() {
        let active = map(&[("scan", 1, "scan-0")]);
        assert_eq!(job_admission(&active, "organize", 1, |_| false), Admission::Start);
    }

    #[test]
    fn resolve_admission_always_spawns_on_start_regardless_of_exclusive() {
        assert_eq!(
            resolve_admission(Admission::Start, "organize", false, 1),
            Resolution::Spawn
        );
        assert_eq!(
            resolve_admission(Admission::Start, "revert", true, 1),
            Resolution::Spawn
        );
    }

    #[test]
    fn resolve_admission_reuses_an_existing_id_when_it_matches_the_prefix_and_not_exclusive() {
        assert_eq!(
            resolve_admission(Admission::Existing("organize-0".into()), "organize", false, 1),
            Resolution::Reuse("organize-0".into())
        );
    }

    /// The core of the "a revert in flight must block organize" ruling:
    /// `start_organize` still dedupes against *another organize job*,
    /// but an `"organize"`-bucket hit that's actually a `"revert-N"` job
    /// (someone else's in-flight revert) must refuse — never be reused
    /// as if it were an organize job, and never silently let a second
    /// organize start alongside it.
    #[test]
    fn resolve_admission_refuses_an_existing_id_from_a_different_prefix_even_when_not_exclusive() {
        assert_eq!(
            resolve_admission(Admission::Existing("revert-3".into()), "organize", false, 1),
            Resolution::Refuse("another job is running on this drive".into())
        );
    }

    /// The mirror image: a revert job already running blocks a *new*
    /// revert attempt the same way — an `"organize"`-bucket hit that's
    /// actually another `"revert-N"` job must also refuse rather than
    /// being reused, since `revert_organize` only ever wants to hear
    /// back about the specific job it targeted.
    #[test]
    fn resolve_admission_refuses_an_existing_id_from_a_different_revert_even_when_not_exclusive() {
        assert_eq!(
            resolve_admission(Admission::Existing("organize-7".into()), "revert", false, 1),
            Resolution::Refuse("another job is running on this drive".into())
        );
    }

    /// `start_scan`'s own bucket (`"scan"`) is never shared with any
    /// other caller — every id tracked under it is always `"scan-N"` —
    /// so a same-kind `Existing` hit there is unaffected by the prefix
    /// check and still dedupes exactly as before.
    #[test]
    fn resolve_admission_leaves_scan_dedupe_unaffected_by_the_prefix_check() {
        assert_eq!(
            resolve_admission(Admission::Existing("scan-0".into()), "scan", false, 1),
            Resolution::Reuse("scan-0".into())
        );
    }

    // Review finding 10: `precheck` (built on `precheck_resolution`) lets
    // `start_scan` bail out of building its skip index before knowing
    // whether the scan would even run.
    #[test]
    fn precheck_resolution_reports_nothing_for_spawn() {
        assert!(precheck_resolution(Resolution::Spawn).is_none());
    }

    #[test]
    fn precheck_resolution_reports_the_existing_id_to_reuse() {
        // `DpResult<String>`'s `Err` arm (`DpError`) has no `PartialEq`, so
        // this can't be a plain `assert_eq!` against the whole `Option`.
        match precheck_resolution(Resolution::Reuse("scan-0".into())) {
            Some(Ok(job_id)) => assert_eq!(job_id, "scan-0"),
            other => panic!("expected Some(Ok(\"scan-0\")), got {other:?}"),
        }
    }

    #[test]
    fn precheck_resolution_reports_the_refusal_as_an_unsupported_error() {
        let result = precheck_resolution(Resolution::Refuse("another job is running on this drive".into()));
        match result {
            Some(Err(DpError::Unsupported { message, path })) => {
                assert_eq!(message, "another job is running on this drive");
                assert_eq!(path, None);
            }
            other => panic!("expected Some(Err(Unsupported)), got {other:?}"),
        }
    }

    /// The core of finding #3: an exclusive caller (`start_revert`) must
    /// never come back with some *other* job's id — only a refusal, with
    /// a generic message that says nothing about which specific job is
    /// in the way. True even when the prefix *would* have matched.
    #[test]
    fn resolve_admission_refuses_an_existing_id_when_exclusive_never_returning_it() {
        assert_eq!(
            resolve_admission(Admission::Existing("revert-0".into()), "revert", true, 1),
            Resolution::Refuse("another job is running on this drive".into())
        );
    }

    #[test]
    fn resolve_admission_names_the_blocking_kind_when_not_exclusive() {
        assert_eq!(
            resolve_admission(
                Admission::Blocked {
                    other_kind: "scan".into()
                },
                "organize",
                false,
                1
            ),
            Resolution::Refuse("a scan job is already running on this drive".into())
        );
    }

    #[test]
    fn resolve_admission_uses_a_generic_message_for_blocked_when_exclusive() {
        assert_eq!(
            resolve_admission(
                Admission::Blocked {
                    other_kind: "scan".into()
                },
                "revert",
                true,
                1
            ),
            Resolution::Refuse("another job is running on this drive".into())
        );
    }

    /// A sidecar sync is a background sweep the user never asked for, so
    /// "a sidecar job is already running on this drive" reads like an
    /// accusation about something they did. It's also always brief —
    /// hence the wording, and the nudge to just try again.
    #[test]
    fn resolve_admission_explains_a_blocking_sidecar_sync_in_plain_words() {
        assert_eq!(
            resolve_admission(
                Admission::Blocked {
                    other_kind: "sidecar".into()
                },
                "organize",
                false,
                1
            ),
            Resolution::Refuse(
                "a background sidecar sync is finishing on this drive — try again in a moment".into()
            )
        );
    }

    /// The core of the drive-0 wording fix: two global sweeps (geocode,
    /// regen) block each other under the same sentinel drive id — see
    /// `AppState::start_regen`'s doc comment — but the refusal must never
    /// say "on this drive", since neither sweep is scoped to one.
    #[test]
    fn resolve_admission_uses_sweep_wording_for_a_blocked_global_job() {
        assert_eq!(
            resolve_admission(
                Admission::Blocked {
                    other_kind: "geocode".into()
                },
                "regen",
                false,
                0
            ),
            Resolution::Refuse("a geocode sweep is already running".into())
        );
    }

    /// The mirror image: a regen already running blocks a new geocode
    /// sweep with the same drive-agnostic wording.
    #[test]
    fn resolve_admission_uses_sweep_wording_regardless_of_which_global_kind_is_blocking() {
        assert_eq!(
            resolve_admission(
                Admission::Blocked {
                    other_kind: "regen".into()
                },
                "geocode",
                false,
                0
            ),
            Resolution::Refuse("a regen sweep is already running".into())
        );
    }

    #[test]
    fn resolve_thumbs_root_uses_the_default_when_nothing_is_configured() {
        let (root, fallback) = resolve_thumbs_root(PathBuf::from("/data/thumbs"), None);
        assert_eq!(root, PathBuf::from("/data/thumbs"));
        assert!(!fallback);
    }

    #[test]
    fn resolve_thumbs_root_adopts_a_usable_cache_shaped_configured_dir() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("drophoto-thumbs");
        std::fs::create_dir_all(&cache).unwrap();
        let (root, fallback) =
            resolve_thumbs_root(PathBuf::from("/data/thumbs"), Some(cache.to_str().unwrap()));
        assert_eq!(root, cache);
        assert!(!fallback);
    }

    #[test]
    fn resolve_thumbs_root_falls_back_when_the_configured_dir_is_missing() {
        let (root, fallback) = resolve_thumbs_root(
            PathBuf::from("/data/thumbs"),
            Some("/Volumes/Unplugged/drophoto-thumbs"),
        );
        assert_eq!(root, PathBuf::from("/data/thumbs"));
        assert!(fallback);
    }

    /// The structural guard: a hand-edited setting pointing at an
    /// arbitrary existing folder must never be adopted as the cache root
    /// — the app would otherwise use it AND later delete it on reset.
    #[test]
    fn resolve_thumbs_root_never_adopts_a_dir_not_named_drophoto_thumbs() {
        let dir = tempfile::tempdir().unwrap();
        let (root, fallback) =
            resolve_thumbs_root(PathBuf::from("/data/thumbs"), Some(dir.path().to_str().unwrap()));
        assert_eq!(root, PathBuf::from("/data/thumbs"));
        assert!(fallback);
    }
}
