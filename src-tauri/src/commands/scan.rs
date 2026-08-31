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
/// UI's "FULL" button), AND unconditionally re-renders both thumbnail
/// slots (see `ScanJob::with_full`) — this is what actually recovers
/// full-resolution previews after the user has downscaled and regenerated
/// them at a lower quality.
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

    // Admission-check up front: a duplicate Scan click (dedupe) or a click
    // while another job holds the drive (refusal) must not first pay for
    // building the skip index below just to throw the result away — see
    // `AppState::precheck`'s doc comment (review finding 10).
    if let Some(result) = state.precheck("scan", drive_id) {
        return result;
    }

    let full = full.unwrap_or(false);
    let skip_index = if full {
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

    let preview_edge = state.catalog.get_settings().await?.preview_edge;
    let deps = ScanDeps {
        catalog: state.catalog.clone(),
        hasher: state.hasher.clone(),
        metadata: state.metadata.clone(),
        thumbs: state.thumbs.clone(),
        store: state.store.clone(),
        sidecars: state.sidecars.clone(),
        preview_edge,
        home: state.home.clone(),
    };

    state.start_scan(drive_id, |job_id| {
        Arc::new(ScanJob::new(job_id, drive, sources, deps, skip_index).with_full(full))
    })
}

#[tauri::command]
pub async fn cancel_job(state: State<'_, AppState>, job_id: String) -> Result<(), DpError> {
    state.runner.cancel(&job_id);
    Ok(())
}
