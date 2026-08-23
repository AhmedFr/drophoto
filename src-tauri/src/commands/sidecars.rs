use crate::state::AppState;
use dp_core::DpError;
use dp_jobs::{Job, SidecarSyncDeps, SidecarSyncJob};
use std::sync::Arc;
use tauri::State;

/// Starts a [`SidecarSyncJob`] for every online drive that has at least
/// one sidecar-pending row, and returns the ids of every job actually
/// started.
///
/// Called by the frontend as a background sweep (after a scan finishes,
/// and whenever the set of known drives changes), not directly by the
/// user, so admission refusal — another job already running on a given
/// drive — is skipped silently rather than surfaced as an error: the next
/// trigger simply retries that drive.
#[tauri::command]
pub async fn start_sidecar_sync_all(state: State<'_, AppState>) -> Result<Vec<String>, DpError> {
    let drives = state.catalog.list_drives().await?;
    let mut started = Vec::new();

    for drive in drives {
        if drive.mount_path.is_none() {
            continue;
        }

        let pending = state.catalog.list_sidecar_pending(drive.id).await?;
        if pending.is_empty() {
            continue;
        }

        let deps = SidecarSyncDeps {
            catalog: state.catalog.clone(),
            sidecars: state.sidecars.clone(),
            home: state.home.clone(),
        };

        let drive_id = drive.id;
        if let Ok(job_id) = state.start_sidecar_sync(drive_id, move |job_id| {
            Arc::new(SidecarSyncJob::new(job_id, drive, deps)) as Arc<dyn Job>
        }) {
            started.push(job_id);
        }
    }

    Ok(started)
}
