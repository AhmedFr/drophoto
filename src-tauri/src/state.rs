use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DpError, DpResult};
use dp_hash::{Blake3Hasher, Hasher};
use dp_jobs::JobRunner;
use dp_metadata::{ExiftoolProvider, MetadataProvider};
use dp_thumbs::{ThumbChain, ThumbStore};
use dp_volumes::{SysinfoVolumes, VolumeProvider};
use std::sync::Arc;
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
    pub runner: JobRunner,
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

        Ok(Self {
            volumes: Arc::new(SysinfoVolumes),
            catalog: Arc::new(catalog),
            hasher: Arc::new(Blake3Hasher),
            metadata: Arc::new(ExiftoolProvider::from_path()),
            thumbs: Arc::new(ThumbChain::default_chain()),
            store: Arc::new(ThumbStore::new(thumbs_root)),
            runner,
        })
    }
}
