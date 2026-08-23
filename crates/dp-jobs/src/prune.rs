//! Pruning of *legacy* catalog rows that today's deny-list would refuse
//! to index: rows scanned before sources (and before the deny-list grew
//! its current rules) that point at a system, package, or hidden
//! location. Run as part of every scan — see [`prune_denied_legacy_rows`].

use std::path::Path;
use std::sync::Arc;

use dp_catalog::Catalog;
use dp_core::denylist::is_denied_path;
use dp_core::DpResult;

/// Deletes `drive_id`'s legacy media rows (`source_id IS NULL` — see
/// [`dp_core::MediaRow::source_id`]) whose `mount.join(rel_path)` the
/// safety deny-list refuses, returning how many were actually removed.
///
/// Those rows predate sources: a fresh scan can never re-create them
/// (the walk skips the very paths they point at), so nothing else would
/// ever clear them, and they'd keep showing up in the UI's `legacy`
/// count as "re-scan to include these" — advice that can't possibly
/// work, because a re-scan is exactly what refuses to look there.
///
/// Deliberately conservative in two ways:
///
/// - Only `source_id IS NULL` rows are considered. A row attributed to a
///   real source is something the current scan is responsible for, not
///   history to clean up.
/// - A row an `organize_items` row still references is left alone (see
///   `Catalog::delete_media`), so a finished organize job stays
///   revertable. Such a row is counted in the returned total only if it
///   was really deleted.
///
/// `mount` must be the canonical mount path — the same one the walk
/// itself uses — and `home` the same value handed to the walk, so the
/// verdict here matches what the scan would decide for the same path.
pub async fn prune_denied_legacy_rows(
    catalog: &Arc<dyn Catalog>,
    drive_id: i64,
    mount: &Path,
    home: Option<&Path>,
) -> DpResult<u64> {
    let rows = catalog.list_media_without_source(drive_id).await?;
    let mut pruned = 0u64;

    for row in rows {
        let abs = mount.join(&row.rel_path);
        if !is_denied_path(&abs, mount, home) {
            continue;
        }
        if catalog.delete_media(row.id).await? {
            pruned += 1;
            tracing::info!(
                drive_id,
                media_id = row.id,
                rel_path = %row.rel_path,
                "pruned a legacy media row under a denied path"
            );
        } else {
            tracing::info!(
                drive_id,
                media_id = row.id,
                rel_path = %row.rel_path,
                "kept a legacy media row under a denied path: an organize job still references it"
            );
        }
    }

    Ok(pruned)
}
