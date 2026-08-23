use crate::state::AppState;
use dp_catalog::normalize_source_rel_path;
use dp_core::denylist::is_denied_path;
use dp_core::{DetectedFolder, DpError, DpResult, Drive, NewSource, Source};
use dp_jobs::detect_folders;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
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

/// Refuses any of `rel_paths` that the safety deny-list would refuse to
/// walk anyway ([`is_denied_path`], checked mount-relative against
/// `mount` exactly as the scan does — same `mount`/`home` arguments).
///
/// Saving such a source would otherwise "succeed" and then quietly scan
/// nothing, since `collect_media_files` filters the very same paths back
/// out. Refusing at save time says so, and names the folder.
///
/// Pure (no catalog, no `AppState`) so it can be unit-tested directly.
/// `rel_paths` are expected to already be normalized — see
/// [`dp_catalog::normalize_source_rel_path`] — and `mount` to be
/// canonical, since `abs` is built from it.
pub(crate) fn reject_denied_sources(mount: &Path, home: Option<&Path>, rel_paths: &[String]) -> DpResult<()> {
    for rel in rel_paths {
        let abs = if rel.is_empty() {
            mount.to_path_buf()
        } else {
            mount.join(rel)
        };
        if is_denied_path(&abs, mount, home) {
            return Err(DpError::Unsupported {
                message: format!("'{rel}' is a system or app location and can't be a source"),
                path: Some(abs.display().to_string()),
            });
        }
    }
    Ok(())
}

/// Reconciles `drive_id`'s configured sources with exactly `rel_paths`:
/// each path is upserted (inserted, or re-enabled if it already existed
/// but was disabled), and any existing, currently-enabled source *not*
/// in `rel_paths` is **disabled** — never deleted.
///
/// Every path is validated *before* anything is written: one that fails
/// normalization (absolute, contains `..`, ...) or that the safety
/// deny-list refuses ([`reject_denied_sources`]) fails the whole call
/// with `Unsupported`, naming the offending path, and **nothing is
/// saved** — no upsert, no disable.
#[tauri::command]
pub async fn save_sources(
    state: State<'_, AppState>,
    drive_id: i64,
    rel_paths: Vec<String>,
) -> Result<(), DpError> {
    let normalized: Vec<String> = rel_paths
        .iter()
        .map(|p| normalize_source_rel_path(p))
        .collect::<DpResult<_>>()?;

    let (_drive, mount) = find_online_drive(&state, drive_id).await?;
    // Canonicalized to match the scan walk's own view of the mount (see
    // `ScanJob::run`), so `abs` and `mount` agree and the deny-list's
    // mount-relative rules line up with what a scan would actually do.
    // A mount that can't be canonicalized (racing an eject, ...) falls
    // back to its literal path rather than blocking the save outright.
    let mount = std::fs::canonicalize(&mount).unwrap_or(mount);
    reject_denied_sources(&mount, state.home.as_deref(), &normalized)?;

    let mut checked_ids: HashSet<i64> = HashSet::new();
    for rel_path in normalized {
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

    fn rels(paths: &[&str]) -> Vec<String> {
        paths.iter().map(|p| p.to_string()).collect()
    }

    #[test]
    fn accepts_ordinary_photo_folders_and_the_mount_root() {
        let mount = Path::new("/Volumes/Backup");
        assert!(reject_denied_sources(mount, None, &rels(&["", "DCIM", "Pictures/2024"])).is_ok());
    }

    #[test]
    fn refuses_a_system_location_naming_the_folder() {
        let mount = Path::new("/Volumes/Backup");
        let err = reject_denied_sources(mount, None, &rels(&["Applications"])).unwrap_err();
        match err {
            DpError::Unsupported { message, .. } => {
                assert_eq!(
                    message,
                    "'Applications' is a system or app location and can't be a source"
                );
            }
            other => panic!("expected Unsupported, got {other:?}"),
        }
    }

    #[test]
    fn refuses_a_package_bundle_and_a_nested_users_library() {
        let mount = Path::new("/Volumes/Backup");
        for rel in [
            "Trip.photoslibrary",
            "Backups/2024/Users/bob/Library",
            "Work/node_modules",
        ] {
            assert!(
                reject_denied_sources(mount, None, &rels(&[rel])).is_err(),
                "expected {rel} refused"
            );
        }
    }

    /// The whole batch is rejected on the *first* denied path, so a
    /// caller mixing a good folder with a bad one saves neither.
    #[test]
    fn refuses_the_whole_batch_when_any_path_is_denied() {
        let mount = Path::new("/Volumes/Backup");
        assert!(reject_denied_sources(mount, None, &rels(&["DCIM", "System"])).is_err());
    }

    #[test]
    fn refuses_the_current_users_library_via_home() {
        let mount = Path::new("/");
        let home = PathBuf::from("/Users/ahmed");
        assert!(reject_denied_sources(mount, Some(&home), &rels(&["Users/ahmed/Library/Photos"])).is_err());
        assert!(reject_denied_sources(mount, Some(&home), &rels(&["Users/ahmed/Pictures"])).is_ok());
    }

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
