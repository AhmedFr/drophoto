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
/// returned — see [`detect_with_timeout`].
const DETECT_TIMEOUT: Duration = Duration::from_secs(20);

/// Finds `drive_id` and confirms it's online, returning the drive
/// alongside its mount path already unwrapped (rather than an
/// `Option<String>` callers would otherwise have to re-check).
async fn find_online_drive(state: &AppState, drive_id: i64) -> DpResult<(Drive, PathBuf)> {
    let drive = state
        .catalog
        .list_drives()
        .await?
        .into_iter()
        .find(|d| d.id == drive_id)
        .ok_or_else(|| DpError::NotFound {
            message: format!("drive {drive_id} not found"),
        })?;

    let mount = drive
        .mount_path
        .clone()
        .ok_or_else(|| DpError::NotFound {
            message: "drive is offline".into(),
        })
        .map(PathBuf::from)?;

    Ok((drive, mount))
}

/// Walks `drive_id`'s mount looking for folders worth offering as import
/// sources. Bounded to [`DETECT_MAX_DEPTH`] levels deep and
/// [`DETECT_TIMEOUT`] wall-clock time — see [`detect_with_timeout`].
#[tauri::command]
pub async fn detect_sources(
    state: State<'_, AppState>,
    drive_id: i64,
) -> Result<Vec<DetectedFolder>, DpError> {
    let (_drive, mount) = find_online_drive(&state, drive_id).await?;
    detect_with_timeout(mount, state.home.clone(), DETECT_TIMEOUT).await
}

/// Runs [`detect_folders`] in a blocking task, bounded by `timeout`: if
/// the walk hasn't finished by then, it's cancelled via a
/// [`CancellationToken`] and whatever it had counted so far is returned
/// as `Ok` rather than failing the call outright — a slow/huge mount
/// should still leave the dialog usable. Either way the spawned blocking
/// task is always awaited to completion before returning (never
/// detached), so no thread is left running past this call.
async fn detect_with_timeout(
    mount: PathBuf,
    home: Option<PathBuf>,
    timeout: Duration,
) -> DpResult<Vec<DetectedFolder>> {
    let cancel = CancellationToken::new();
    let task_cancel = cancel.clone();
    let mut handle = tokio::task::spawn_blocking(move || {
        detect_folders(&mount, DETECT_MAX_DEPTH, home.as_deref(), &task_cancel)
    });

    tokio::select! {
        result = &mut handle => {
            return join_detect_result(result);
        }
        _ = tokio::time::sleep(timeout) => {
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

/// Reconciles `drive_id`'s configured sources with exactly `rel_paths`:
/// each path is upserted (inserted, or re-enabled if it already existed
/// but was disabled), and any existing, currently-enabled source *not*
/// in `rel_paths` is **disabled** — never deleted. A path that fails
/// validation (absolute, contains `..`, ...) fails the whole call with
/// `Unsupported`, naming the offending path; nothing already upserted or
/// disabled in this call is rolled back.
#[tauri::command]
pub async fn save_sources(
    state: State<'_, AppState>,
    drive_id: i64,
    rel_paths: Vec<String>,
) -> Result<(), DpError> {
    let mut checked_ids: HashSet<i64> = HashSet::new();
    for rel_path in rel_paths {
        let source = state
            .catalog
            .upsert_source(NewSource { drive_id, rel_path })
            .await?;
        checked_ids.insert(source.id);
    }

    let existing = state.catalog.list_sources(drive_id).await?;
    for s in existing {
        if s.enabled && !checked_ids.contains(&s.id) {
            state.catalog.set_source_enabled(s.id, false).await?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[tokio::test]
    async fn detect_with_timeout_returns_ok_with_partial_results_when_the_walk_outlasts_the_budget() {
        let dir = tempfile::tempdir().unwrap();
        // A wide-enough tree that a synchronous walk takes measurably
        // longer than a 1ms budget, so the timeout branch — cancel, then
        // await the blocking task for whatever it already found — is
        // actually exercised instead of racing a walk that just finishes
        // first.
        for d in 0..50 {
            let sub = dir.path().join(format!("d{d}"));
            std::fs::create_dir_all(&sub).unwrap();
            for f in 0..100 {
                std::fs::write(sub.join(format!("f{f}.jpg")), b"x").unwrap();
            }
        }

        let start = Instant::now();
        let result = detect_with_timeout(dir.path().to_path_buf(), None, Duration::from_millis(1)).await;
        let elapsed = start.elapsed();

        // `detect_with_timeout` only ever returns once the spawned
        // blocking task has been awaited to completion (either branch of
        // the `select!`, or the post-timeout `handle.await`), so getting
        // any result back at all — let alone this quickly — demonstrates
        // the task was joined rather than detached/leaked.
        assert!(result.is_ok(), "expected Ok with partial results, got {result:?}");
        assert!(
            elapsed < Duration::from_secs(5),
            "took {elapsed:?}; the 1ms timeout doesn't seem to be cancelling the walk"
        );
    }

    #[tokio::test]
    async fn detect_with_timeout_returns_ok_for_a_small_tree_finishing_well_within_budget() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.jpg"), b"x").unwrap();

        let result = detect_with_timeout(dir.path().to_path_buf(), None, Duration::from_secs(20)).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap().iter().map(|f| f.media_count).sum::<u64>(), 1);
    }
}
