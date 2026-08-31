use crate::state::AppState;
use dp_core::DpError;
use dp_jobs::{ScanDeps, ScanJob};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;

/// Starts a scan of `drive_id`. Incremental by default: unchanged files
/// (matching stat size/mtime, thumbnails already on disk) are skipped
/// without re-hashing — see `dp_jobs::ScanJob`. `full: Some(true)` bypasses
/// that skip index entirely, re-hashing and re-thumbnailing every file (the
/// UI's "FULL" button).
#[tauri::command]
pub async fn start_scan(
    state: State<'_, AppState>,
    drive_id: i64,
    full: Option<bool>,
) -> Result<String, DpError> {
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

    let sources = state.catalog.list_enabled_sources(drive_id).await?;
    if sources.is_empty() {
        return Err(DpError::Unsupported {
            message: "no sources configured for this drive".into(),
            path: None,
        });
    }

    let skip_index = if full.unwrap_or(false) {
        HashMap::new()
    } else {
        state
            .catalog
            .list_scan_index(drive_id)
            .await?
            .into_iter()
            .map(|e| (e.rel_path.clone(), e))
            .collect()
    };

    let deps = ScanDeps {
        catalog: state.catalog.clone(),
        hasher: state.hasher.clone(),
        metadata: state.metadata.clone(),
        thumbs: state.thumbs.clone(),
        store: state.store.clone(),
        sidecars: state.sidecars.clone(),
        home: state.home.clone(),
    };

    state.start_scan(drive_id, |job_id| {
        Arc::new(ScanJob::new(job_id, drive, sources, deps, skip_index))
    })
}

#[tauri::command]
pub async fn cancel_job(state: State<'_, AppState>, job_id: String) -> Result<(), DpError> {
    state.runner.cancel(&job_id);
    Ok(())
}
