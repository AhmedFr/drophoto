use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DpError, DpResult};
use dp_volumes::{SysinfoVolumes, VolumeProvider};
use std::sync::Arc;
use tauri::Manager;

pub struct AppState {
    pub volumes: Arc<dyn VolumeProvider>,
    pub catalog: Arc<dyn Catalog>,
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
        Ok(Self {
            volumes: Arc::new(SysinfoVolumes),
            catalog: Arc::new(catalog),
        })
    }
}
