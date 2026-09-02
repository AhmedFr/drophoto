use crate::commands::organize_plan::{plan_for_drive, DrivePlan};
use crate::state::AppState;
use dp_core::denylist::is_denied_name;
use dp_core::{
    DpError, OrganizeDefaults, OrganizeItemRow, OrganizeJobRow, OrganizePlan, OrganizeRule, PlanStatus,
    UnorganizedSummary,
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

/// Current settings-backed organize-rule defaults — see
/// [`dp_core::OrganizeDefaults`].
#[tauri::command]
pub async fn get_organize_defaults(state: State<'_, AppState>) -> Result<OrganizeDefaults, DpError> {
    state.catalog.get_organize_defaults().await
}

/// Persists the settings-backed organize-rule defaults — every configured
/// (`Some`) field is validated exactly like [`save_rule`] validates a
/// drive's own rule (same [`validate_root`]/`validate_template` reused,
/// not duplicated), so a bad default can never later surface as an opaque
/// failure the first time a fresh drive's rule is composed from it. An
/// unset (`None`) field skips validation entirely — it isn't a value that
/// needs to render, just the absence of an override.
#[tauri::command]
pub async fn set_organize_defaults(
    state: State<'_, AppState>,
    defaults: OrganizeDefaults,
) -> Result<(), DpError> {
    validate_organize_defaults(&defaults)?;
    state.catalog.set_organize_defaults(&defaults).await
}

/// The validation [`set_organize_defaults`] performs, factored out so it's
/// unit-testable without a running `AppState`/Tauri app — same pattern as
/// [`check_revertable`]/[`validate_root`]. Every configured (`Some`)
/// field is validated exactly like [`save_rule`] validates a drive's own
/// rule; an unset (`None`) field is skipped entirely.
fn validate_organize_defaults(defaults: &OrganizeDefaults) -> Result<(), DpError> {
    if let Some(root) = &defaults.root {
        validate_root(root)?;
    }
    if let Some(folder_tpl) = &defaults.folder_tpl {
        validate_template(folder_tpl)?;
    }
    if let Some(file_tpl) = &defaults.file_tpl {
        validate_template(file_tpl)?;
    }
    Ok(())
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

/// Whether an already-running job tracked under some admission bucket
/// may be *adopted* by a caller that spawns ids prefixed `id_prefix`.
///
/// `AppState::active_job` is keyed by admission *bucket*, and the
/// `"organize"` bucket holds both `"organize-N"` and `"revert-N"` ids
/// (see `AppState::start_revert`). So a hit there is only this caller's
/// own in-flight job — safe to hand back as a dedupe — when the id
/// itself agrees; a `"revert-N"` id means someone else's revert is
/// running on the drive, and returning it would have `start_organize`
/// report a revert's job id as if it were the organize run the caller
/// asked for. Refuse instead, with the same generic message
/// `resolve_admission` uses for the equivalent conflict.
///
/// `None` in means nothing is running: `Ok(None)` out, spawn normally.
fn adopt_existing(active: Option<String>, id_prefix: &str) -> Result<Option<String>, DpError> {
    match active {
        None => Ok(None),
        Some(job_id) if job_id.starts_with(&format!("{id_prefix}-")) => Ok(Some(job_id)),
        Some(_) => Err(DpError::Unsupported {
            message: "another job is running on this drive".into(),
            path: None,
        }),
    }
}

#[tauri::command]
pub async fn start_organize(state: State<'_, AppState>, drive_id: i64) -> Result<String, DpError> {
    // Skip the (re-)planning and job-row creation below entirely when an
    // organize job is already running for this drive — `state.start_organize`
    // dedupes the actual spawn either way, but there's no point doing
    // the work (or leaving an orphaned `organize_jobs` row) for a plan
    // that will just be thrown away. A *revert* tracked under the same
    // `"organize"` bucket is not ours to adopt — see [`adopt_existing`].
    if let Some(job_id) = adopt_existing(state.active_job("organize", drive_id), "organize")? {
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
/// it's already been reverted (`reverted_by_job_id` is set — which, per
/// `RevertJob::run_inner`, only happens once a revert finished with
/// *zero* failed items; a partial or fully-failed revert never sets
/// this, so a retry always stays available) — the second revert's items
/// would just fail one-by-one against paths the first revert already
/// restored, so refusing up front gives a clearer error than a job that
/// "succeeds" having reverted nothing.
#[tauri::command]
pub async fn revert_organize(state: State<'_, AppState>, job_id: i64) -> Result<String, DpError> {
    let job = state
        .catalog
        .get_organize_job(job_id)
        .await?
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

    // Refuse up front — before ever creating a `revert_jobs` row — when
    // another job is already running on this drive. `state.start_revert`
    // is exclusive (see its doc comment: unlike `start_organize`, it
    // never reuses another job's id) and would refuse this exact case on
    // its own, but checking here first avoids creating a row only to
    // immediately have to close it back out for a revert that was never
    // going to run.
    if state.active_job("organize", job.drive_id).is_some()
        || state.active_job("scan", job.drive_id).is_some()
    {
        return Err(DpError::Unsupported {
            message: "another job is running on this drive".into(),
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

    // Unlike `start_organize`'s dance with an `AtomicBool` flag,
    // `state.start_revert` only ever spawns or refuses — it never
    // reuses another job's id (see its doc comment) — so any `Err` here
    // unambiguously means nothing was spawned and the row just created
    // above is orphaned. Close it out as `"failed"`, not `"cancelled"`:
    // it never ran, and `"failed"` is exactly the status that (per the
    // ruling on `RevertJob`'s own status logic) never blocks a retry.
    let drive_id = job.drive_id;
    match state.start_revert(drive_id, move |revert_id| {
        Arc::new(RevertJob::new(revert_id, drive, revert_row_id, items, deps)) as Arc<dyn Job>
    }) {
        Ok(runner_job_id) => Ok(runner_job_id),
        Err(e) => {
            if let Err(finish_err) = state
                .catalog
                .finish_organize_job(revert_row_id, "failed", 0, 0, 0)
                .await
            {
                tracing::warn!(error = %finish_err, revert_row_id, "failed to close out an orphaned revert job row");
            }
            Err(e)
        }
    }
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
    use super::{adopt_existing, check_revertable, validate_organize_defaults, validate_root};
    use chrono::Utc;
    use dp_core::{DpError, OrganizeDefaults, OrganizeJobRow};

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
    fn adopt_existing_spawns_when_nothing_is_running() {
        assert_eq!(adopt_existing(None, "organize").unwrap(), None);
    }

    #[test]
    fn adopt_existing_reuses_an_organize_id() {
        assert_eq!(
            adopt_existing(Some("organize-4".into()), "organize").unwrap(),
            Some("organize-4".into())
        );
    }

    /// The bug: `active_job("organize", ..)` also sees `"revert-N"` ids
    /// (both share the `"organize"` admission bucket), and returning one
    /// made `start_organize` hand a revert's job id back as if the
    /// organize run the caller asked for had started.
    #[test]
    fn adopt_existing_refuses_a_revert_id() {
        let err = adopt_existing(Some("revert-9".into()), "organize").unwrap_err();
        assert!(
            matches!(&err, DpError::Unsupported { message, .. } if message == "another job is running on this drive"),
            "got {err:?}"
        );
    }

    /// A prefix that merely *starts the same way* isn't a match: only a
    /// full `"{prefix}-"` boundary counts.
    #[test]
    fn adopt_existing_refuses_an_id_that_only_shares_a_prefix_substring() {
        assert!(adopt_existing(Some("organizer-1".into()), "organize").is_err());
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

    #[test]
    fn validate_organize_defaults_accepts_every_field_unset() {
        assert!(validate_organize_defaults(&OrganizeDefaults::default()).is_ok());
    }

    #[test]
    fn validate_organize_defaults_accepts_valid_configured_fields() {
        let defaults = OrganizeDefaults {
            root: Some("archive".into()),
            folder_tpl: Some("{{yyyy}}/{{mm}}".into()),
            file_tpl: Some("{{stem}}".into()),
            keep_pairs: Some(true),
        };
        assert!(validate_organize_defaults(&defaults).is_ok());
    }

    #[test]
    fn validate_organize_defaults_rejects_a_bad_root() {
        let defaults = OrganizeDefaults {
            root: Some("/abs".into()),
            ..OrganizeDefaults::default()
        };
        assert!(matches!(
            validate_organize_defaults(&defaults),
            Err(DpError::Unsupported { .. })
        ));
    }

    #[test]
    fn validate_organize_defaults_rejects_a_bad_folder_template() {
        let defaults = OrganizeDefaults {
            folder_tpl: Some("{{bogus}}".into()),
            ..OrganizeDefaults::default()
        };
        assert!(matches!(
            validate_organize_defaults(&defaults),
            Err(DpError::Unsupported { .. })
        ));
    }

    #[test]
    fn validate_organize_defaults_rejects_a_bad_file_template() {
        let defaults = OrganizeDefaults {
            file_tpl: Some("{{bogus}}".into()),
            ..OrganizeDefaults::default()
        };
        assert!(matches!(
            validate_organize_defaults(&defaults),
            Err(DpError::Unsupported { .. })
        ));
    }
}
