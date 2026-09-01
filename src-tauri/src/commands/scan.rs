use crate::state::AppState;
use dp_core::{DpError, ScanErrorRow};
use dp_jobs::{ScanDeps, ScanJob};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;

/// Max rows a single `list_scan_errors` call returns, regardless of what
/// the caller asks for — `ScanErrorsDialog` pages 100 at a time, and this
/// keeps a stray large `limit` from pulling a huge `scan_errors` history
/// into memory in one call.
const SCAN_ERRORS_LIMIT_CAP: u32 = 500;

/// Caps `limit` at [`SCAN_ERRORS_LIMIT_CAP`], leaving anything at or under
/// the cap (including 0) untouched. Pure so it can be unit-tested directly,
/// same as `metrics::clamped_limit`.
fn clamped_limit(limit: u32) -> u32 {
    limit.min(SCAN_ERRORS_LIMIT_CAP)
}

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

/// How many `scan_errors` rows `drive_id` currently has — the cheap query
/// `DriveCard`'s actions dropdown checks (cached via TanStack Query) to
/// decide whether to show an "Errors…" item at all.
#[tauri::command]
pub async fn count_scan_errors(state: State<'_, AppState>, drive_id: i64) -> Result<u64, DpError> {
    state.catalog.count_scan_errors(drive_id).await
}

/// Pages `drive_id`'s `scan_errors` rows, newest first — backs
/// `ScanErrorsDialog`'s "Load more" paging. `limit` is clamped to
/// [`SCAN_ERRORS_LIMIT_CAP`].
#[tauri::command]
pub async fn list_scan_errors(
    state: State<'_, AppState>,
    drive_id: i64,
    limit: u32,
    offset: u32,
) -> Result<Vec<ScanErrorRow>, DpError> {
    state
        .catalog
        .list_scan_errors(drive_id, clamped_limit(limit), offset)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_a_limit_under_the_cap_untouched() {
        assert_eq!(clamped_limit(50), 50);
    }

    #[test]
    fn leaves_a_limit_exactly_at_the_cap_untouched() {
        assert_eq!(clamped_limit(SCAN_ERRORS_LIMIT_CAP), SCAN_ERRORS_LIMIT_CAP);
    }

    #[test]
    fn clamps_a_limit_over_the_cap_down_to_the_cap() {
        assert_eq!(clamped_limit(SCAN_ERRORS_LIMIT_CAP + 1), SCAN_ERRORS_LIMIT_CAP);
        assert_eq!(clamped_limit(100_000), SCAN_ERRORS_LIMIT_CAP);
    }

    #[test]
    fn leaves_zero_untouched() {
        assert_eq!(clamped_limit(0), 0);
    }
}
