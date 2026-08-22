use crate::commands::organize_plan::{plan_for_drive, DrivePlan};
use crate::state::AppState;
use dp_core::{
    DpError, OrganizeItemRow, OrganizeJobRow, OrganizePlan, OrganizeRule, PlanStatus, UnorganizedSummary,
};
use dp_jobs::{OrganizeDeps, OrganizeJob};
use dp_organize::validate_template;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_rule(state: State<'_, AppState>, drive_id: i64) -> Result<OrganizeRule, DpError> {
    state.catalog.get_rule(drive_id).await
}

#[tauri::command]
pub async fn save_rule(state: State<'_, AppState>, rule: OrganizeRule) -> Result<(), DpError> {
    validate_template(&rule.folder_tpl)?;
    validate_template(&rule.file_tpl)?;
    state.catalog.save_rule(&rule).await
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

        result.planned += items.iter().filter(|i| i.status == PlanStatus::Planned).count() as u64;
        result.skipped_dup += items
            .iter()
            .filter(|i| i.status == PlanStatus::SkippedDup)
            .count() as u64;
        result.in_place += items
            .iter()
            .filter(|i| {
                i.status == PlanStatus::SkippedCollision && i.reason.as_deref() == Some("already in place")
            })
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

    let DrivePlan { items, .. } = plan_for_drive(&state.catalog, &drive).await?;
    let job_row_id = state
        .catalog
        .create_organize_job(drive_id, items.len() as u64)
        .await?;

    let deps = OrganizeDeps {
        catalog: state.catalog.clone(),
        strategy: state.strategy.clone(),
    };

    let id = state.start_organize(drive_id, |job_id| {
        Arc::new(OrganizeJob::new(job_id, drive, job_row_id, items, deps))
    });
    Ok(id)
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
