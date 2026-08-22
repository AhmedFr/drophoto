use crate::commands::organize_plan::{plan_for_drive, DrivePlan};
use crate::state::AppState;
use dp_core::{
    DpError, OrganizeItemRow, OrganizeJobRow, OrganizePlan, OrganizeRule, PlanStatus, UnorganizedSummary,
};
use dp_jobs::{Job, OrganizeDeps, OrganizeJob};
use dp_organize::validate_template;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_rule(state: State<'_, AppState>, drive_id: i64) -> Result<OrganizeRule, DpError> {
    state.catalog.get_rule(drive_id).await
}

#[tauri::command]
pub async fn save_rule(state: State<'_, AppState>, rule: OrganizeRule) -> Result<(), DpError> {
    validate_root(&rule.root)?;
    validate_template(&rule.folder_tpl)?;
    validate_template(&rule.file_tpl)?;
    state.catalog.save_rule(&rule).await
}

/// Validates an [`OrganizeRule::root`]: non-empty, not absolute, and free
/// of `.`/`..` traversal components or characters (`\`, NUL) that could
/// otherwise be abused to build a path escaping the drive's mount point
/// once joined with a rendered template (see `OrganizeJob::apply_move`'s
/// own, final `escapes_mount` check in `dp-jobs`, which this is the
/// first line of defense for).
fn validate_root(root: &str) -> Result<(), DpError> {
    let unsupported = |message: String| DpError::Unsupported { message, path: None };

    if root.is_empty() {
        return Err(unsupported("root must not be empty".into()));
    }
    if root.starts_with('/') {
        return Err(unsupported("root must not start with '/'".into()));
    }
    if root.contains('\\') || root.contains('\0') {
        return Err(unsupported("root must not contain '\\' or a NUL byte".into()));
    }
    for part in root.split('/') {
        if part == "." || part == ".." {
            return Err(unsupported(format!("root must not contain '{part}' components")));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn list_unorganized_summaries(
    state: State<'_, AppState>,
) -> Result<Vec<UnorganizedSummary>, DpError> {
    let drives = state.catalog.list_drives().await?;
    let mut summaries = Vec::with_capacity(drives.len());
    for drive in drives {
        let rule = state.catalog.get_rule(drive.id).await?;
        summaries.push(state.catalog.unorganized_summary(drive.id, &rule.root).await?);
    }
    Ok(summaries)
}

#[tauri::command]
pub async fn plan_organize(state: State<'_, AppState>, drive_ids: Vec<i64>) -> Result<OrganizePlan, DpError> {
    let drives = state.catalog.list_drives().await?;
    let mut result = OrganizePlan::default();

    for drive_id in drive_ids {
        let drive = drives
            .iter()
            .find(|d| d.id == drive_id)
            .ok_or_else(|| DpError::NotFound {
                message: format!("drive {drive_id} not found"),
            })?;
        let DrivePlan { items, bytes } = plan_for_drive(&state.catalog, drive).await?;

        result.planned += planned_count(&items);
        result.skipped_dup += items
            .iter()
            .filter(|i| i.status == PlanStatus::SkippedDup)
            .count() as u64;
        result.bytes += bytes;
        result.items.extend(items);
    }

    Ok(result)
}

#[tauri::command]
pub async fn start_organize(state: State<'_, AppState>, drive_id: i64) -> Result<String, DpError> {
    // Skip the (re-)planning and job-row creation below entirely when a
    // job is already running for this drive — `state.start_organize`
    // dedupes the actual spawn either way, but there's no point doing
    // the work (or leaving an orphaned `organize_jobs` row) for a plan
    // that will just be thrown away.
    if let Some(job_id) = state.active_job("organize", drive_id) {
        return Ok(job_id);
    }

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

    let DrivePlan { items, .. } = plan_for_drive(&state.catalog, &drive).await?;
    let job_row_id = state
        .catalog
        .create_organize_job(drive_id, planned_count(&items))
        .await?;

    let deps = OrganizeDeps {
        catalog: state.catalog.clone(),
        strategy: state.strategy.clone(),
    };

    // `state.start_organize` may decide *not* to call `make_job` at all —
    // either because a same-kind job is already running (its id is
    // reused) or a different-kind job blocks this one (an error is
    // returned instead). Either way, the `organize_jobs` row just created
    // above would otherwise be left stuck `"running"` forever with no
    // `OrganizeJob` ever going to finish it, so detect that case via this
    // flag and close the row out ourselves.
    let spawned = Arc::new(AtomicBool::new(false));
    let spawned_flag = spawned.clone();
    let result = state.start_organize(drive_id, move |job_id| {
        spawned_flag.store(true, Ordering::SeqCst);
        Arc::new(OrganizeJob::new(job_id, drive, job_row_id, items, deps)) as Arc<dyn Job>
    });

    if !spawned.load(Ordering::SeqCst) {
        if let Err(e) = state
            .catalog
            .finish_organize_job(job_row_id, "cancelled", 0, 0, 0)
            .await
        {
            tracing::warn!(error = %e, job_row_id, "failed to close out an orphaned organize job row");
        }
    }

    result
}

/// Count of `Planned` items — matches [`OrganizePlan::planned`], and is
/// what `organize_jobs.planned` should reflect too (skipped items were
/// never going to be moved in the first place).
fn planned_count(items: &[dp_core::OrganizePlanItem]) -> u64 {
    items.iter().filter(|i| i.status == PlanStatus::Planned).count() as u64
}

#[tauri::command]
pub async fn list_jobs(state: State<'_, AppState>, limit: u32) -> Result<Vec<OrganizeJobRow>, DpError> {
    state.catalog.list_organize_jobs(limit).await
}

#[tauri::command]
pub async fn list_job_items(
    state: State<'_, AppState>,
    job_id: i64,
    limit: u32,
) -> Result<Vec<OrganizeItemRow>, DpError> {
    state.catalog.list_organize_items(job_id, limit).await
}

#[cfg(test)]
mod tests {
    use super::validate_root;
    use dp_core::DpError;

    #[test]
    fn rejects_absolute_root() {
        assert!(matches!(validate_root("/abs"), Err(DpError::Unsupported { .. })));
    }

    #[test]
    fn rejects_leading_parent_dir() {
        assert!(matches!(validate_root("../x"), Err(DpError::Unsupported { .. })));
    }

    #[test]
    fn rejects_embedded_parent_dir() {
        assert!(matches!(
            validate_root("a/../b"),
            Err(DpError::Unsupported { .. })
        ));
    }

    #[test]
    fn rejects_empty_root() {
        assert!(matches!(validate_root(""), Err(DpError::Unsupported { .. })));
    }

    #[test]
    fn accepts_a_plain_relative_root() {
        assert!(validate_root("archive").is_ok());
        assert!(validate_root("my/nested/archive").is_ok());
    }
}
