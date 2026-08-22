use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DpError, DpResult};
use dp_hash::{Blake3Hasher, Hasher};
use dp_jobs::{Job, JobRunner};
use dp_metadata::{ExiftoolProvider, MetadataProvider};
use dp_organize::{default_strategy, MoveStrategy};
use dp_thumbs::{ThumbChain, ThumbStore};
use dp_volumes::{SysinfoVolumes, VolumeProvider};
use std::collections::HashMap;
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
    /// Job id of the in-flight job for each `(kind, drive_id)` pair,
    /// where `kind` is `"scan"` or `"organize"` — each drive can have at
    /// most one running job of each kind at a time. Stale entries (a job
    /// that finished or was cancelled) are pruned lazily the next time
    /// [`AppState::start_scan`]/[`AppState::start_organize`] checks them
    /// against [`JobRunner::is_running`].
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

        Ok(Self {
            volumes: Arc::new(SysinfoVolumes),
            catalog: Arc::new(catalog),
            strategy: default_strategy(hasher.clone()),
            hasher,
            metadata: Arc::new(ExiftoolProvider::from_path()),
            thumbs: Arc::new(ThumbChain::default_chain()),
            store: Arc::new(ThumbStore::new(thumbs_root)),
            runner,
            active_jobs: Mutex::new(HashMap::new()),
        })
    }

    /// Starts a scan for `drive_id`, unless one is already running for it —
    /// in which case the existing job id is returned instead of starting a
    /// duplicate. `make_job` builds the [`Job`] given the id it will run
    /// under.
    pub fn start_scan(&self, drive_id: i64, make_job: impl FnOnce(String) -> Arc<dyn Job>) -> String {
        self.start_job("scan", drive_id, make_job)
    }

    /// Starts an organize job for `drive_id`, unless one is already
    /// running for it — in which case the existing job id is returned
    /// instead of starting a duplicate. `make_job` builds the [`Job`]
    /// given the id it will run under.
    pub fn start_organize(&self, drive_id: i64, make_job: impl FnOnce(String) -> Arc<dyn Job>) -> String {
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

    /// Starts a `kind` job ("scan" or "organize") for `drive_id`, unless
    /// one is already running for that `(kind, drive_id)` pair — in which
    /// case the existing job id is returned instead of starting a
    /// duplicate.
    ///
    /// The check-and-insert happens under a single lock acquisition so two
    /// concurrent calls for the same `(kind, drive_id)` can't both observe
    /// "not running" and each spawn their own job.
    fn start_job(&self, kind: &str, drive_id: i64, make_job: impl FnOnce(String) -> Arc<dyn Job>) -> String {
        let key = (kind.to_string(), drive_id);
        let mut jobs = lock_active_jobs(&self.active_jobs);
        if let Some(job_id) = jobs.get(&key) {
            if self.runner.is_running(job_id) {
                return job_id.clone();
            }
        }

        let job_id = self.runner.next_id(kind);
        self.runner.spawn(job_id.clone(), make_job(job_id.clone()));
        jobs.insert(key, job_id.clone());
        job_id
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
