use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DpError, DpResult};
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

        let thumbs_root = dir.join("thumbs");
        std::fs::create_dir_all(&thumbs_root)
            .map_err(|e| DpError::io(&e, thumbs_root.display().to_string()))?;

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

        Ok(Self {
            volumes: Arc::new(SysinfoVolumes),
            catalog,
            strategy: default_strategy(hasher.clone()),
            hasher,
            metadata: Arc::new(ExiftoolProvider::from_path()),
            thumbs: Arc::new(ThumbChain::default_chain()),
            store: Arc::new(ThumbStore::new(thumbs_root)),
            sidecars: Arc::new(ExiftoolSidecars::from_path()),
            geocoder,
            runner,
            home,
            active_jobs: Mutex::new(HashMap::new()),
        })
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
        let mut jobs = lock_active_jobs(&self.active_jobs);
        let decision = job_admission(&jobs, admission_kind, drive_id, |id| self.runner.is_running(id));

        match resolve_admission(decision, id_prefix, exclusive) {
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
fn resolve_admission(decision: Admission, id_prefix: &str, exclusive: bool) -> Resolution {
    const GENERIC_CONFLICT: &str = "another job is running on this drive";
    const SIDECAR_CONFLICT: &str =
        "a background sidecar sync is finishing on this drive — try again in a moment";

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
            } else {
                Resolution::Refuse(format!("a {other_kind} job is already running on this drive"))
            }
        }
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
            resolve_admission(Admission::Start, "organize", false),
            Resolution::Spawn
        );
        assert_eq!(
            resolve_admission(Admission::Start, "revert", true),
            Resolution::Spawn
        );
    }

    #[test]
    fn resolve_admission_reuses_an_existing_id_when_it_matches_the_prefix_and_not_exclusive() {
        assert_eq!(
            resolve_admission(Admission::Existing("organize-0".into()), "organize", false),
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
            resolve_admission(Admission::Existing("revert-3".into()), "organize", false),
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
            resolve_admission(Admission::Existing("organize-7".into()), "revert", false),
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
            resolve_admission(Admission::Existing("scan-0".into()), "scan", false),
            Resolution::Reuse("scan-0".into())
        );
    }

    /// The core of finding #3: an exclusive caller (`start_revert`) must
    /// never come back with some *other* job's id — only a refusal, with
    /// a generic message that says nothing about which specific job is
    /// in the way. True even when the prefix *would* have matched.
    #[test]
    fn resolve_admission_refuses_an_existing_id_when_exclusive_never_returning_it() {
        assert_eq!(
            resolve_admission(Admission::Existing("revert-0".into()), "revert", true),
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
                false
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
                true
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
                false
            ),
            Resolution::Refuse(
                "a background sidecar sync is finishing on this drive — try again in a moment".into()
            )
        );
    }
}
