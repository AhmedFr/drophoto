//! Planning helper shared by the `plan_organize` and `start_organize`
//! commands: computes the organize plan for a single drive.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use dp_catalog::Catalog;
use dp_core::{DpResult, Drive, MediaRow, OrganizePlanItem, PlanStatus};
use dp_organize::{plan, validate_template, HandlebarsTemplate, PlanInput};

use crate::commands::organize::validate_root;

/// The plan computed for a single drive: the items themselves, plus the
/// total size (in bytes) of every `Planned` item, so callers don't need
/// to re-join against `MediaRow` sizes.
#[derive(Debug)]
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

    // `save_rule` validates before writing, but a rule read back from
    // the catalog could still predate a validation rule (or have been
    // written by something else entirely). Re-validate here and fail
    // loudly rather than plan moves from a rule nobody vetted — this
    // runs before a single path is rendered.
    validate_root(&rule.root)?;
    validate_template(&rule.folder_tpl)?;
    validate_template(&rule.file_tpl)?;

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
        // Only rows scanned under a confirmed source are ever candidates
        // for a move — see `PlanInput::require_source`'s own docs.
        require_source: true,
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

    let fallback_ids: Vec<i64> = rows.iter().map(|r| r.id).collect();

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
    .unwrap_or_else(|e| {
        tracing::warn!(error = %e, "mtime lookup task panicked or was cancelled; falling back to taken_at/now for all rows");
        fallback_ids.into_iter().map(|id| (id, None)).collect()
    })
}

#[cfg(test)]
mod tests {
    use super::plan_for_drive;
    use dp_catalog::{Catalog, SqliteCatalog};
    use dp_core::{DpError, DriveRole, NewDrive, OrganizeRule};
    use std::sync::Arc;

    async fn catalog_with_drive() -> (Arc<dyn Catalog>, dp_core::Drive) {
        let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
        let drive = catalog
            .register_drive(NewDrive {
                name: "A".into(),
                mount_path: "/Volumes/A".into(),
                role: DriveRole::Source,
                capacity: 100,
                free: 40,
            })
            .await
            .unwrap();
        (catalog, drive)
    }

    #[tokio::test]
    async fn refuses_to_plan_from_a_rule_with_a_traversing_root() {
        let (catalog, drive) = catalog_with_drive().await;
        // Written straight to the catalog, bypassing `save_rule`'s own
        // validation — exactly the case this guard exists for.
        catalog
            .save_rule(&OrganizeRule {
                root: "../escape".into(),
                ..OrganizeRule::default_for(drive.id)
            })
            .await
            .unwrap();

        let err = plan_for_drive(&catalog, &drive).await.unwrap_err();
        assert!(matches!(err, DpError::Unsupported { .. }), "got {err:?}");
    }

    #[tokio::test]
    async fn refuses_to_plan_from_a_rule_with_an_invalid_template() {
        let (catalog, drive) = catalog_with_drive().await;
        catalog
            .save_rule(&OrganizeRule {
                folder_tpl: "{{yyyy}}/../{{mm}}".into(),
                ..OrganizeRule::default_for(drive.id)
            })
            .await
            .unwrap();

        let err = plan_for_drive(&catalog, &drive).await.unwrap_err();
        assert!(matches!(err, DpError::Unsupported { .. }), "got {err:?}");
    }

    #[tokio::test]
    async fn plans_from_a_valid_default_rule() {
        let (catalog, drive) = catalog_with_drive().await;
        let plan = plan_for_drive(&catalog, &drive).await.unwrap();
        assert!(plan.items.is_empty());
        assert_eq!(plan.bytes, 0);
    }

    /// A row scanned before sources existed (`source_id: None`) must
    /// never be planned for a move — `plan_for_drive` sets
    /// `PlanInput::require_source: true` precisely to enforce this.
    #[tokio::test]
    async fn skips_a_row_with_no_source() {
        use dp_core::{MediaKind, NewMedia};

        let (catalog, drive) = catalog_with_drive().await;
        catalog
            .upsert_media(NewMedia {
                drive_id: drive.id,
                rel_path: "legacy.jpg".into(),
                hash: "h-legacy".into(),
                size: 100,
                kind: MediaKind::Photo,
                ext: "jpg".into(),
                width: None,
                height: None,
                duration_ms: None,
                taken_at: None,
                camera: None,
                lens: None,
                aperture: None,
                shutter: None,
                iso: None,
                focal_mm: None,
                lat: None,
                lon: None,
                organized_at: None,
                source_id: None,
                mtime: None,
            })
            .await
            .unwrap();

        let plan = plan_for_drive(&catalog, &drive).await.unwrap();
        assert!(
            plan.items
                .iter()
                .all(|i| i.status != dp_core::PlanStatus::Planned),
            "a source-less row must never be planned: {:?}",
            plan.items
        );
    }
}
