use crate::state::AppState;
use dp_core::{DetectedFolder, Drive, DpError, DpResult, NewSource, Source};
use dp_jobs::detect_folders;
use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;
use tauri::State;
use tokio_util::sync::CancellationToken;

/// Detection is capped to a shallow walk of the mount, so a mount with a
/// pathological folder structure can't hang the dialog forever.
const DETECT_MAX_DEPTH: usize = 4;

/// Hard wall-clock budget for a `detect_sources` walk. If the walk hasn't
/// finished by then, it's cancelled and whatever it found so far is
/// returned — see [`detect_sources`].
const DETECT_TIMEOUT: Duration = Duration::from_secs(20);

async fn find_online_drive(state: &AppState, drive_id: i64) -> DpResult<Drive> {
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
    Ok(drive)
}

/// Walks `drive_id`'s mount looking for folders worth offering as import
/// sources. Bounded to [`DETECT_MAX_DEPTH`] levels deep and
/// [`DETECT_TIMEOUT`] wall-clock time: if the timeout fires first, the
/// walk is cancelled and whatever it had counted so far is returned
/// rather than failing the command outright — a slow/huge mount should
/// still leave the dialog usable.
#[tauri::command]
pub async fn detect_sources(
    state: State<'_, AppState>,
    drive_id: i64,
) -> Result<Vec<DetectedFolder>, DpError> {
    let drive = find_online_drive(&state, drive_id).await?;
    let mount = PathBuf::from(drive.mount_path.expect("checked online above"));
    let home = state.home.clone();

    let cancel = CancellationToken::new();
    let task_cancel = cancel.clone();
    let mut handle = tokio::task::spawn_blocking(move || {
        detect_folders(&mount, DETECT_MAX_DEPTH, home.as_deref(), &task_cancel)
    });

    tokio::select! {
        result = &mut handle => {
            return join_detect_result(result);
        }
        _ = tokio::time::sleep(DETECT_TIMEOUT) => {
            cancel.cancel();
        }
    }

    join_detect_result(handle.await)
}

fn join_detect_result(
    result: Result<DpResult<Vec<DetectedFolder>>, tokio::task::JoinError>,
) -> DpResult<Vec<DetectedFolder>> {
    result.map_err(|e| DpError::Io {
        message: format!("source detection task failed: {e}"),
        path: None,
    })?
}

#[tauri::command]
pub async fn list_sources(state: State<'_, AppState>, drive_id: i64) -> Result<Vec<Source>, DpError> {
    state.catalog.list_sources(drive_id).await
}

/// Replaces `drive_id`'s configured sources with exactly `rel_paths`:
/// each path is upserted (inserted, or re-enabled if it already existed
/// but was disabled), and any existing source *not* in `rel_paths` is
/// deleted outright — this is a full replace, not a merge. A path that
/// fails validation (absolute, contains `..`, ...) fails the whole call
/// with `Unsupported`, naming the offending path; nothing already
/// upserted in this call is rolled back.
#[tauri::command]
pub async fn save_sources(
    state: State<'_, AppState>,
    drive_id: i64,
    rel_paths: Vec<String>,
) -> Result<(), DpError> {
    let mut kept_ids: HashSet<i64> = HashSet::new();
    for rel_path in rel_paths {
        let source = state
            .catalog
            .upsert_source(NewSource { drive_id, rel_path })
            .await?;
        kept_ids.insert(source.id);
    }

    let existing = state.catalog.list_sources(drive_id).await?;
    for s in existing {
        if !kept_ids.contains(&s.id) {
            state.catalog.delete_source(s.id).await?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn set_source_enabled(
    state: State<'_, AppState>,
    source_id: i64,
    enabled: bool,
) -> Result<(), DpError> {
    state.catalog.set_source_enabled(source_id, enabled).await
}
