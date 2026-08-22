use crate::state::AppState;
use dp_core::DpError;
use dp_jobs::{ScanDeps, ScanJob};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn start_scan(state: State<'_, AppState>, drive_id: i64) -> Result<String, DpError> {
    let drive = state
        .catalog
        .list_drives()
        .await?
        .into_iter()
        .find(|d| d.id == drive_id)
        .ok_or_else(|| DpError::NotFound {
            message: format!("drive {drive_id} not found"),
        })?;

    if drive.mount_path.is_none() {
        return Err(DpError::NotFound {
            message: "drive is offline".into(),
        });
    }

    let deps = ScanDeps {
        catalog: state.catalog.clone(),
        hasher: state.hasher.clone(),
        metadata: state.metadata.clone(),
        thumbs: state.thumbs.clone(),
        store: state.store.clone(),
    };

    let id = state.start_scan(drive_id, |job_id| Arc::new(ScanJob::new(job_id, drive, deps)));
    Ok(id)
}

#[tauri::command]
pub async fn cancel_job(state: State<'_, AppState>, job_id: String) -> Result<(), DpError> {
    state.runner.cancel(&job_id);
    Ok(())
}
