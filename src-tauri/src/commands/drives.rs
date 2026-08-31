use crate::state::AppState;
use dp_core::{DpError, Drive, NewDrive};
use tauri::State;

/// The per-drive job kinds [`forget_drive`] refuses to run alongside — a
/// scan, organize/revert (both tracked under the `"organize"` admission
/// bucket — see `AppState::start_organize`/`start_revert`), or a sidecar
/// sync could all still be writing rows for this drive_id; forgetting it
/// out from under one would either race the write or silently resurrect
/// rows the job re-inserts. Global jobs (geocode/regen, tracked under the
/// sentinel drive id `0`) are never scoped to a single drive, so they're
/// never checked here.
const DRIVE_JOB_KINDS: [&str; 3] = ["scan", "organize", "sidecar"];

#[tauri::command]
pub async fn register_drive(state: State<'_, AppState>, input: NewDrive) -> Result<Drive, DpError> {
    state.catalog.register_drive(input).await
}

#[tauri::command]
pub async fn list_drives(state: State<'_, AppState>) -> Result<Vec<Drive>, DpError> {
    state.catalog.list_drives().await
}

/// Permanently forgets `drive_id` — deletes it and every catalog row that
/// references it (see `dp_catalog::forget_drive`'s doc comment for the
/// exact cascade). Refuses while any job is running for this drive: a
/// running scan/organize/sidecar-sync could still be inserting or
/// updating rows this same call is about to delete out from under it.
/// Works offline (an unplugged drive is exactly the case this action
/// exists for) — never touches the filesystem, only `catalog.db`.
#[tauri::command]
pub async fn forget_drive(state: State<'_, AppState>, drive_id: i64) -> Result<(), DpError> {
    for kind in DRIVE_JOB_KINDS {
        if state.active_job(kind, drive_id).is_some() {
            return Err(DpError::Unsupported {
                message: format!(
                    "a {kind} job is running on this drive — wait for it to finish before forgetting it"
                ),
                path: None,
            });
        }
    }
    state.catalog.forget_drive(drive_id).await
}

/// How many media rows `drive_id` currently has in the catalog — what the
/// `FORGET…` confirmation dialog shows the user before they type the
/// confirmation phrase ("removes N photos…"), so the count reflects
/// reality even for a drive that's currently offline (no filesystem walk
/// involved, purely a catalog read).
#[tauri::command]
pub async fn count_drive_media(state: State<'_, AppState>, drive_id: i64) -> Result<u64, DpError> {
    state.catalog.count_media(Some(drive_id)).await
}
