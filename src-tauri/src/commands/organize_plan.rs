//! Planning helper shared by the `plan_organize` and `start_organize`
//! commands: computes the organize plan for a single drive.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use dp_catalog::Catalog;
use dp_core::{DpResult, Drive, MediaRow, OrganizePlanItem, PlanStatus};
use dp_organize::{plan, HandlebarsTemplate, PlanInput};

/// The plan computed for a single drive: the items themselves, plus the
/// total size (in bytes) of every `Planned` item, so callers don't need
/// to re-join against `MediaRow` sizes.
pub(crate) struct DrivePlan {
    pub items: Vec<OrganizePlanItem>,
    pub bytes: u64,
}

/// Computes the organize plan for `drive`: fetches its rule and
/// unorganized rows, resolves which of those rows are already organized
/// elsewhere (as a duplicate) and which relative paths are already taken
/// under the rule's root, then runs the pure planner from `dp-organize`.
pub(crate) async fn plan_for_drive(catalog: &Arc<dyn Catalog>, drive: &Drive) -> DpResult<DrivePlan> {
    let rule = catalog.get_rule(drive.id).await?;
    let rows = catalog.list_unorganized(drive.id, &rule.root).await?;

    let hashes: Vec<String> = rows.iter().map(|r| r.hash.clone()).collect();
    let organized_hashes = catalog.organized_hashes(&hashes).await?;

    // Every path already occupied under this drive (organized or not),
    // plus each unorganized row's own current path — so a row that ends
    // up skipped still reserves its own name against the rest of the
    // batch, per `PlanInput::existing_paths`'s contract.
    let mut existing_paths: HashSet<String> = catalog.list_rel_paths(drive.id).await?.into_iter().collect();
    for row in &rows {
        existing_paths.insert(row.rel_path.clone());
    }

    let sizes: HashMap<i64, u64> = rows.iter().map(|r| (r.id, r.size)).collect();
    let mtimes = compute_mtimes(drive.mount_path.clone(), &rows).await;
    let mtime_fn = move |row: &MediaRow| mtimes.get(&row.id).copied().flatten();

    let input = PlanInput {
        rule: &rule,
        rows: &rows,
        organized_hashes: &organized_hashes,
        existing_paths: &existing_paths,
        now: Utc::now(),
    };
    let items = plan(&input, &HandlebarsTemplate, &mtime_fn)?;

    let bytes = items
        .iter()
        .filter(|i| i.status == PlanStatus::Planned)
        .filter_map(|i| sizes.get(&i.media_id))
        .sum();

    Ok(DrivePlan { items, bytes })
}

/// Resolves each row's on-disk mtime (via `std::fs::metadata`, run on a
/// blocking thread) keyed by media id, so the synchronous planner can
/// consult it through a plain closure. A row's mtime is `None` when the
/// drive is offline (`mount_path` is `None`) or the file can't be
/// stat'd — the planner falls back to `taken_at`/`now` in that case.
async fn compute_mtimes(
    mount_path: Option<String>,
    rows: &[MediaRow],
) -> HashMap<i64, Option<DateTime<Utc>>> {
    let Some(mount) = mount_path else {
        return rows.iter().map(|r| (r.id, None)).collect();
    };

    let targets: Vec<(i64, PathBuf)> = rows
        .iter()
        .map(|r| (r.id, PathBuf::from(&mount).join(&r.rel_path)))
        .collect();

    tokio::task::spawn_blocking(move || {
        targets
            .into_iter()
            .map(|(id, path)| {
                let mtime = std::fs::metadata(&path)
                    .and_then(|m| m.modified())
                    .ok()
                    .map(DateTime::<Utc>::from);
                (id, mtime)
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}
