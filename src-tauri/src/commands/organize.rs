use crate::commands::organize_plan::{plan_for_drive, DrivePlan};
use crate::state::AppState;
use dp_core::denylist::is_denied_name;
use dp_core::{
    DpError, OrganizeItemRow, OrganizeJobRow, OrganizePlan, OrganizeRule, PlanStatus, UnorganizedSummary,
};
use dp_jobs::{Job, OrganizeDeps, OrganizeJob, RevertJob};
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
///
/// Every check runs against the *trimmed* root: `"   "` is as empty as
/// `""` (it would otherwise be accepted and file photos into a folder
/// literally named with spaces), and `" /abs"` is as absolute as
/// `"/abs"`.
pub(crate) fn validate_root(root: &str) -> Result<(), DpError> {
    let unsupported = |message: String| DpError::Unsupported { message, path: None };
    let root = root.trim();

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
        // Also refuse a root that would file every organized photo into a
        // directory the safety deny-list would otherwise refuse to move
        // *out of* (see `dp_core::denylist::is_denied_name`) — a rule
        // named `Caches` or `Foo.app` would organize into a black hole.
        if is_denied_name(part) {
            return Err(unsupported(format!(
                "root must not contain a denied directory name: '{part}'"
            )));
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
        let DrivePlan { items, bytes, legacy } = plan_for_drive(&state.catalog, drive).await?;

        result.planned += planned_count(&items);
        result.skipped_dup += items
            .iter()
            .filter(|i| i.status == PlanStatus::SkippedDup)
            .count() as u64;
        result.bytes += bytes;
        result.legacy_rows += legacy;
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

    // A scan running on this same drive blocks an organize job (see
    // `job_admission`) — but only once `state.start_organize` is
    // reached, by which point a plan has been computed and an
    // `organize_jobs` row created, which then has to be closed out as a
    // phantom `"cancelled"` run the user never asked for. Refuse up
    // front instead.
    if state.active_job("scan", drive_id).is_some() {
        return Err(DpError::Unsupported {
            message: "a scan job is already running on this drive".into(),
            path: None,
        });
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
        home: state.home.clone(),
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

/// Pure refusal logic behind [`revert_organize`]: whether `job` is a
/// valid target for a revert at all. Kept separate from the command body
/// so it's unit-testable without a running `AppState`/Tauri app — see
/// the `tests` module below.
fn check_revertable(job: &OrganizeJobRow) -> Result<(), DpError> {
    let unsupported = |message: &str| DpError::Unsupported {
        message: message.into(),
        path: None,
    };

    if job.status == "running" {
        return Err(unsupported("the job is still running"));
    }
    if job.kind != "organize" {
        return Err(unsupported("only an organize job can be reverted"));
    }
    if job.reverted_by_job_id.is_some() {
        return Err(unsupported("this job has already been reverted"));
    }
    Ok(())
}

/// Reverts a finished organize job: moves every item it actually moved
/// back to its original location, in reverse order (see
/// [`dp_jobs::RevertJob`]).
///
/// Refuses with [`DpError::Unsupported`] when the job is still running
/// (there's nothing finished to undo yet), when it isn't an `"organize"`
/// job in the first place (reverting a revert isn't supported), or when
/// it's already been reverted (`reverted_by_job_id` is set) — the second
/// revert's items would just fail one-by-one against paths the first
/// revert already restored, so refusing up front gives a clearer error
/// than a job that "succeeds" having reverted nothing.
#[tauri::command]
pub async fn revert_organize(state: State<'_, AppState>, job_id: i64) -> Result<String, DpError> {
    let job = state
        .catalog
        .list_organize_jobs(u32::MAX)
        .await?
        .into_iter()
        .find(|j| j.id == job_id)
        .ok_or_else(|| DpError::NotFound {
            message: format!("organize job {job_id} not found"),
        })?;

    check_revertable(&job)?;

    let drive = state
        .catalog
        .list_drives()
        .await?
        .into_iter()
        .find(|d| d.id == job.drive_id)
        .ok_or_else(|| DpError::NotFound {
            message: format!("drive {} not found", job.drive_id),
        })?;

    if drive.mount_path.is_none() {
        return Err(DpError::NotFound {
            message: "drive is offline".into(),
        });
    }

    // Same up-front dedup/exclusivity check `start_organize` makes: skip
    // the work below entirely when a job is already running on this
    // drive, rather than leaving an orphaned `organize_jobs` row for a
    // revert that will just be thrown away.
    if let Some(existing_job_id) = state.active_job("organize", job.drive_id) {
        return Ok(existing_job_id);
    }
    if state.active_job("scan", job.drive_id).is_some() {
        return Err(DpError::Unsupported {
            message: "a scan job is already running on this drive".into(),
            path: None,
        });
    }

    let items = state.catalog.list_organize_items(job_id, u32::MAX).await?;
    let planned = items.iter().filter(|i| i.status == PlanStatus::Moved).count() as u64;

    let revert_row_id = state
        .catalog
        .create_revert_job(job.drive_id, job_id, planned)
        .await?;

    let deps = OrganizeDeps {
        catalog: state.catalog.clone(),
        strategy: state.strategy.clone(),
        home: state.home.clone(),
    };

    // See `start_organize`'s identical comment: `state.start_revert` may
    // decide not to call `make_job` at all, which would otherwise leave
    // the row just created above stuck `"running"` forever.
    let spawned = Arc::new(AtomicBool::new(false));
    let spawned_flag = spawned.clone();
    let drive_id = job.drive_id;
    let result = state.start_revert(drive_id, move |revert_id| {
        spawned_flag.store(true, Ordering::SeqCst);
        Arc::new(RevertJob::new(revert_id, drive, revert_row_id, items, deps)) as Arc<dyn Job>
    });

    if !spawned.load(Ordering::SeqCst) {
        if let Err(e) = state
            .catalog
            .finish_organize_job(revert_row_id, "cancelled", 0, 0, 0)
            .await
        {
            tracing::warn!(error = %e, revert_row_id, "failed to close out an orphaned revert job row");
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
    use super::{check_revertable, validate_root};
    use chrono::Utc;
    use dp_core::{DpError, OrganizeJobRow};

    fn job(status: &str, kind: &str, reverted_by_job_id: Option<i64>) -> OrganizeJobRow {
        OrganizeJobRow {
            id: 1,
            drive_id: 1,
            drive_name: "Drive".into(),
            status: status.into(),
            planned: 1,
            moved: 1,
            skipped: 0,
            failed: 0,
            started_at: Utc::now(),
            finished_at: Some(Utc::now()),
            kind: kind.into(),
            reverts_job_id: None,
            reverted_by_job_id,
        }
    }

    #[test]
    fn refuses_a_still_running_job() {
        assert!(matches!(
            check_revertable(&job("running", "organize", None)),
            Err(DpError::Unsupported { .. })
        ));
    }

    #[test]
    fn refuses_a_job_that_is_not_an_organize_job() {
        assert!(matches!(
            check_revertable(&job("done", "revert", None)),
            Err(DpError::Unsupported { .. })
        ));
    }

    #[test]
    fn refuses_a_job_already_reverted() {
        assert!(matches!(
            check_revertable(&job("done", "organize", Some(2))),
            Err(DpError::Unsupported { .. })
        ));
    }

    #[test]
    fn accepts_a_finished_never_reverted_organize_job() {
        assert!(check_revertable(&job("done", "organize", None)).is_ok());
    }

    #[test]
    fn accepts_a_cancelled_organize_job() {
        assert!(check_revertable(&job("cancelled", "organize", None)).is_ok());
    }

    #[test]
    fn accepts_a_failed_organize_job() {
        assert!(check_revertable(&job("failed", "organize", None)).is_ok());
    }

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
    fn rejects_a_whitespace_only_root() {
        assert!(matches!(validate_root("   "), Err(DpError::Unsupported { .. })));
    }

    #[test]
    fn rejects_an_absolute_root_hidden_behind_whitespace() {
        assert!(matches!(
            validate_root("  /abs"),
            Err(DpError::Unsupported { .. })
        ));
    }

    #[test]
    fn accepts_a_plain_relative_root() {
        assert!(validate_root("archive").is_ok());
        assert!(validate_root("my/nested/archive").is_ok());
    }

    /// A root named after a denied directory (see
    /// `dp_core::denylist::is_denied_name`) would file every organized
    /// photo straight into a location the deny-list would otherwise
    /// refuse to touch on the way *out*. Refuse it on the way in instead.
    #[test]
    fn rejects_a_root_that_is_a_denied_name() {
        assert!(matches!(
            validate_root("Caches"),
            Err(DpError::Unsupported { .. })
        ));
        assert!(matches!(
            validate_root("Foo.app"),
            Err(DpError::Unsupported { .. })
        ));
    }

    #[test]
    fn rejects_a_nested_root_component_that_is_a_denied_name() {
        assert!(matches!(
            validate_root("archive/Caches"),
            Err(DpError::Unsupported { .. })
        ));
    }
}
