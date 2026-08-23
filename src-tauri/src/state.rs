use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DpError, DpResult};
use dp_hash::{Blake3Hasher, Hasher};
use dp_jobs::{Job, JobRunner};
use dp_metadata::{ExiftoolProvider, MetadataProvider};
use dp_organize::{default_strategy, MoveStrategy};
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
    pub strategy: Arc<dyn MoveStrategy>,
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
        let catalog = SqliteCatalog::open(&db_path).await?;

        let thumbs_root = dir.join("thumbs");
        std::fs::create_dir_all(&thumbs_root)
            .map_err(|e| DpError::io(&e, thumbs_root.display().to_string()))?;

        let (tx, mut rx) = mpsc::channel(JOB_EVENT_CHANNEL_CAPACITY);
        let runner = JobRunner::new(tx);

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

        Ok(Self {
            volumes: Arc::new(SysinfoVolumes),
            catalog: Arc::new(catalog),
            strategy: default_strategy(hasher.clone()),
            hasher,
            metadata: Arc::new(ExiftoolProvider::from_path()),
            thumbs: Arc::new(ThumbChain::default_chain()),
            store: Arc::new(ThumbStore::new(thumbs_root)),
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
        let mut jobs = lock_active_jobs(&self.active_jobs);

        match job_admission(&jobs, kind, drive_id, |id| self.runner.is_running(id)) {
            Admission::Existing(job_id) => Ok(job_id),
            Admission::Blocked { other_kind } => Err(DpError::Unsupported {
                message: format!("a {other_kind} job is already running on this drive"),
                path: None,
            }),
            Admission::Start => {
                let job_id = self.runner.next_id(kind);
                self.runner.spawn(job_id.clone(), make_job(job_id.clone()));
                jobs.insert((kind.to_string(), drive_id), job_id.clone());
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
}
