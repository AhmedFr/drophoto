//! User-defined tags on media rows: the `tags`/`media_tags` tables, and the
//! `sidecar_pending` flag on `media` that tracks when a row's tag set has
//! changed since its sidecar file was last written.

use crate::media::row_to_media;
use crate::sqlite::db;
use dp_core::{DpResult, MediaRow, SidecarHealth, Tag, TagWithCount};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};
use std::collections::HashSet;

fn row_to_tag(row: &SqliteRow) -> DpResult<Tag> {
    Ok(Tag {
        id: row.try_get("id").map_err(db)?,
        name: row.try_get("name").map_err(db)?,
    })
}

pub(crate) async fn list_tags(pool: &SqlitePool) -> DpResult<Vec<Tag>> {
    let rows = sqlx::query("SELECT id, name FROM tags ORDER BY name COLLATE NOCASE")
        .fetch_all(pool)
        .await
        .map_err(db)?;
    rows.iter().map(row_to_tag).collect()
}

/// Every tag with its linked-media count, for the Tags page — see
/// [`TagWithCount`]'s doc comment. `LEFT JOIN` (not an inner join) so a
/// tag with zero links still appears, with `count = 0`.
pub(crate) async fn list_tags_with_counts(pool: &SqlitePool) -> DpResult<Vec<TagWithCount>> {
    let rows = sqlx::query(
        "SELECT t.id AS id, t.name AS name, COUNT(mt.media_id) AS count \
         FROM tags t LEFT JOIN media_tags mt ON mt.tag_id = t.id \
         GROUP BY t.id ORDER BY t.name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await
    .map_err(db)?;
    rows.iter()
        .map(|r| {
            let count: i64 = r.try_get("count").map_err(db)?;
            Ok(TagWithCount {
                tag: row_to_tag(r)?,
                count: count as u64,
            })
        })
        .collect()
}

/// `(media_id, tag)` pairs for every id in `ids`, tags ordered by name.
/// `ids.is_empty()` short-circuits to `Ok(vec![])` — an empty SQL `IN ()`
/// is a syntax error, so this must never reach the query.
pub(crate) async fn tags_for_media(pool: &SqlitePool, ids: &[i64]) -> DpResult<Vec<(i64, Tag)>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = vec!["?"; ids.len()].join(",");
    let sql = format!(
        "SELECT mt.media_id AS media_id, t.id AS id, t.name AS name \
         FROM media_tags mt JOIN tags t ON t.id = mt.tag_id \
         WHERE mt.media_id IN ({placeholders}) ORDER BY t.name COLLATE NOCASE"
    );
    let mut q = sqlx::query(&sql);
    for id in ids {
        q = q.bind(id);
    }
    let rows = q.fetch_all(pool).await.map_err(db)?;
    rows.iter()
        .map(|r| {
            let media_id: i64 = r.try_get("media_id").map_err(db)?;
            Ok((media_id, row_to_tag(r)?))
        })
        .collect()
}

/// Tag names for one media row, ordered by name (for sidecar writing).
pub(crate) async fn tag_names_for_media(pool: &SqlitePool, media_id: i64) -> DpResult<Vec<String>> {
    let rows = sqlx::query(
        "SELECT t.name AS name FROM media_tags mt JOIN tags t ON t.id = mt.tag_id \
         WHERE mt.media_id = ? ORDER BY t.name COLLATE NOCASE",
    )
    .bind(media_id)
    .fetch_all(pool)
    .await
    .map_err(db)?;
    rows.iter().map(|r| r.try_get("name").map_err(db)).collect()
}

/// Creates any missing tags in `add` (name-insensitive), links them to
/// every id in `ids`, unlinks every tag id in `remove` from every id in
/// `ids`, and sets `sidecar_pending = 1` on every id whose tag set
/// actually changed — the whole call runs in one transaction. "Actually
/// changed" is decided by `rows_affected` on the underlying `INSERT OR
/// IGNORE` (link) / `DELETE` (unlink), so re-adding an already-linked tag
/// or removing one that was never linked never marks a row pending.
pub(crate) async fn tag_media(
    pool: &SqlitePool,
    ids: &[i64],
    add: &[String],
    remove: &[i64],
) -> DpResult<()> {
    if ids.is_empty() || (add.is_empty() && remove.is_empty()) {
        return Ok(());
    }

    let mut tx = pool.begin().await.map_err(db)?;

    let mut add_tag_ids = Vec::with_capacity(add.len());
    for name in add {
        sqlx::query("INSERT OR IGNORE INTO tags (name) VALUES (?)")
            .bind(name)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        let id: i64 = sqlx::query_scalar("SELECT id FROM tags WHERE name = ? COLLATE NOCASE")
            .bind(name)
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        add_tag_ids.push(id);
    }

    let mut changed: HashSet<i64> = HashSet::new();
    for &media_id in ids {
        for &tag_id in &add_tag_ids {
            let result = sqlx::query("INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)")
                .bind(media_id)
                .bind(tag_id)
                .execute(&mut *tx)
                .await
                .map_err(db)?;
            if result.rows_affected() > 0 {
                changed.insert(media_id);
            }
        }
        for &tag_id in remove {
            let result = sqlx::query("DELETE FROM media_tags WHERE media_id = ? AND tag_id = ?")
                .bind(media_id)
                .bind(tag_id)
                .execute(&mut *tx)
                .await
                .map_err(db)?;
            if result.rows_affected() > 0 {
                changed.insert(media_id);
            }
        }
    }

    for media_id in &changed {
        sqlx::query("UPDATE media SET sidecar_pending = 1 WHERE id = ?")
            .bind(media_id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }

    tx.commit().await.map_err(db)?;

    // FTS is derived data — never fail the write over a sync problem.
    for &media_id in ids {
        if let Err(e) = crate::fts::sync_fts(pool, media_id).await {
            tracing::warn!(media_id, error = %e, "failed to sync FTS index after tag_media");
        }
    }

    Ok(())
}

/// Renames tag `id` to `new_name` — expected already trimmed/validated by
/// the caller (see [`crate::tags`]'s module docs and, on the command side,
/// `src-tauri/src/commands/tags.rs::normalize_tag_names`, the same
/// validator `tag_media`'s `add` entries go through; this function doesn't
/// duplicate that check).
///
/// If `new_name` collides case-insensitively with a *different* existing
/// tag, this is treated as a **merge into that tag** rather than an error:
/// `id`'s media links move onto the colliding tag and `id` itself is
/// deleted (see [`merge_tags`]) — the rename the user asked for still
/// results in every affected photo carrying the target name, it just does
/// so by joining the two tags instead of ending up with two tags sharing
/// one name. A `new_name` identical to `id`'s current name (byte-for-byte)
/// is a no-op that touches nothing, not even a redundant `UPDATE`.
pub(crate) async fn rename_tag(pool: &SqlitePool, id: i64, new_name: &str) -> DpResult<()> {
    let current_name: Option<String> = sqlx::query_scalar("SELECT name FROM tags WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(db)?;
    let Some(current_name) = current_name else {
        // Tag no longer exists — nothing to rename, same tolerant
        // no-op-on-missing-id style as `delete_source`/`set_source_enabled`.
        return Ok(());
    };
    if current_name == new_name {
        return Ok(());
    }

    let existing: Option<i64> =
        sqlx::query_scalar("SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id != ?")
            .bind(new_name)
            .bind(id)
            .fetch_optional(pool)
            .await
            .map_err(db)?;
    if let Some(into_id) = existing {
        return merge_tags(pool, &[id], into_id).await;
    }

    // Plain retitle: every media row currently linked to `id` has its
    // displayed tag name change, so every one of them is "affected" here —
    // unlike `tag_media`'s per-row `rows_affected` check, there's no way
    // for a subset to be unaffected by the tag they're linked to changing
    // name.
    let mut tx = pool.begin().await.map_err(db)?;
    sqlx::query("UPDATE tags SET name = ? WHERE id = ?")
        .bind(new_name)
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    let media_ids: Vec<i64> = sqlx::query_scalar("SELECT media_id FROM media_tags WHERE tag_id = ?")
        .bind(id)
        .fetch_all(&mut *tx)
        .await
        .map_err(db)?;
    for &media_id in &media_ids {
        sqlx::query("UPDATE media SET sidecar_pending = 1 WHERE id = ?")
            .bind(media_id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }
    tx.commit().await.map_err(db)?;

    for media_id in media_ids {
        if let Err(e) = crate::fts::sync_fts(pool, media_id).await {
            tracing::warn!(media_id, error = %e, "failed to sync FTS index after rename_tag");
        }
    }
    Ok(())
}

/// Merges every tag in `from_ids` into `into_id`: every media row linked to
/// any of `from_ids` gets linked to `into_id` instead (`INSERT OR IGNORE`,
/// so a row already linked to both doesn't end up with a duplicate), then
/// each emptied `from_ids` tag is deleted (its now-superseded
/// `media_tags` rows are cleaned up by the `ON DELETE CASCADE` FK, whether
/// or not they were already explicitly relinked above). Any id in
/// `from_ids` equal to `into_id` is dropped first — merging a tag into
/// itself is a no-op for that id.
///
/// Every media row that was linked to any of `from_ids` is "affected":
/// even one already also linked to `into_id` loses a distinct tag name
/// from its sidecar-visible tag list (the two tags can't share a name —
/// `tags.name` is `UNIQUE COLLATE NOCASE`), so `sidecar_pending` is set
/// and FTS resynced for the whole set, computed once up front rather than
/// via `tag_media`'s per-link `rows_affected` check.
pub(crate) async fn merge_tags(pool: &SqlitePool, from_ids: &[i64], into_id: i64) -> DpResult<()> {
    let from_ids: Vec<i64> = from_ids.iter().copied().filter(|&id| id != into_id).collect();
    if from_ids.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await.map_err(db)?;

    let placeholders = vec!["?"; from_ids.len()].join(",");
    let select_sql = format!("SELECT DISTINCT media_id FROM media_tags WHERE tag_id IN ({placeholders})");
    let mut select_q = sqlx::query_scalar(&select_sql);
    for id in &from_ids {
        select_q = select_q.bind(id);
    }
    let affected: Vec<i64> = select_q.fetch_all(&mut *tx).await.map_err(db)?;

    for &media_id in &affected {
        sqlx::query("INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)")
            .bind(media_id)
            .bind(into_id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }

    let delete_sql = format!("DELETE FROM tags WHERE id IN ({placeholders})");
    let mut delete_q = sqlx::query(&delete_sql);
    for id in &from_ids {
        delete_q = delete_q.bind(id);
    }
    delete_q.execute(&mut *tx).await.map_err(db)?;

    for &media_id in &affected {
        sqlx::query("UPDATE media SET sidecar_pending = 1 WHERE id = ?")
            .bind(media_id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }

    tx.commit().await.map_err(db)?;

    for media_id in affected {
        if let Err(e) = crate::fts::sync_fts(pool, media_id).await {
            tracing::warn!(media_id, error = %e, "failed to sync FTS index after merge_tags");
        }
    }
    Ok(())
}

/// Deletes tag `id` and every one of its `media_tags` links (the FK's `ON
/// DELETE CASCADE` handles the links; `id` not existing is a tolerant
/// no-op). Every media row that was linked to `id` is affected — it loses
/// a tag name from its sidecar-visible list — so `sidecar_pending` is set
/// and FTS resynced for each, in the same transaction as the delete.
pub(crate) async fn delete_tag(pool: &SqlitePool, id: i64) -> DpResult<()> {
    let mut tx = pool.begin().await.map_err(db)?;

    let media_ids: Vec<i64> = sqlx::query_scalar("SELECT media_id FROM media_tags WHERE tag_id = ?")
        .bind(id)
        .fetch_all(&mut *tx)
        .await
        .map_err(db)?;

    sqlx::query("DELETE FROM tags WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;

    for &media_id in &media_ids {
        sqlx::query("UPDATE media SET sidecar_pending = 1 WHERE id = ?")
            .bind(media_id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
    }

    tx.commit().await.map_err(db)?;

    for media_id in media_ids {
        if let Err(e) = crate::fts::sync_fts(pool, media_id).await {
            tracing::warn!(media_id, error = %e, "failed to sync FTS index after delete_tag");
        }
    }
    Ok(())
}

pub(crate) async fn list_sidecar_pending(pool: &SqlitePool, drive_id: i64) -> DpResult<Vec<MediaRow>> {
    let rows = sqlx::query("SELECT * FROM media WHERE drive_id = ? AND sidecar_pending = 1 ORDER BY id")
        .bind(drive_id)
        .fetch_all(pool)
        .await
        .map_err(db)?;
    rows.iter().map(row_to_media).collect()
}

/// Whether *any* row on `drive_id` is flagged `sidecar_pending`. A
/// `SELECT EXISTS(...)` rather than a `list_sidecar_pending(..).is_empty()`
/// check: the caller sweeping every drive only wants a yes/no, and
/// materialising every pending `MediaRow` just to throw them away scales
/// with the size of a tagging spree.
///
/// Excludes rows with `missing_at` set: a missing photo's sidecar can never
/// be written (`sidecar_sync` refuses it and deliberately leaves the flag
/// set so a later sweep retries), so counting it here would make this
/// return `true` forever and re-spawn a guaranteed-to-fail sync on every
/// launch — see `JobEventsBridge`, which gates that spawn on this call.
pub(crate) async fn has_sidecar_pending(pool: &SqlitePool, drive_id: i64) -> DpResult<bool> {
    let exists: i64 = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM media WHERE drive_id = ? \
         AND sidecar_pending = 1 AND missing_at IS NULL)",
    )
    .bind(drive_id)
    .fetch_one(pool)
    .await
    .map_err(db)?;
    Ok(exists != 0)
}

pub(crate) async fn clear_sidecar_pending(pool: &SqlitePool, media_id: i64) -> DpResult<()> {
    sqlx::query("UPDATE media SET sidecar_pending = 0 WHERE id = ?")
        .bind(media_id)
        .execute(pool)
        .await
        .map_err(db)?;
    Ok(())
}

pub(crate) async fn mark_sidecar_pending(pool: &SqlitePool, media_id: i64) -> DpResult<()> {
    sqlx::query("UPDATE media SET sidecar_pending = 1 WHERE id = ?")
        .bind(media_id)
        .execute(pool)
        .await
        .map_err(db)?;
    Ok(())
}

/// Every media row on `drive_id` with at least one `media_tags` link — the
/// exact set `check_sidecar_files` stats a `.xmp` for, and whose count is
/// [`SidecarHealth::tagged`]. `EXISTS` rather than a `JOIN` +
/// `SELECT DISTINCT`: a row with several tags must still appear once.
///
/// Excludes rows with `missing_at` set: the last scan couldn't find the
/// file, so there is no sidecar to verify. Without this filter,
/// `check_sidecar_files` stats a `.xmp` that is *correctly* absent next to
/// a photo that no longer exists, flags `sidecar_pending`, and — because
/// the file is gone — nothing can ever clear that flag; see
/// `has_sidecar_pending` and `sidecar_sync`'s existence guard.
pub(crate) async fn list_tagged_media(pool: &SqlitePool, drive_id: i64) -> DpResult<Vec<MediaRow>> {
    let rows = sqlx::query(
        "SELECT * FROM media WHERE drive_id = ? \
         AND EXISTS (SELECT 1 FROM media_tags WHERE media_tags.media_id = media.id) \
         AND missing_at IS NULL \
         ORDER BY id",
    )
    .bind(drive_id)
    .fetch_all(pool)
    .await
    .map_err(db)?;
    rows.iter().map(row_to_media).collect()
}

/// `drive_id`'s sidecar coverage for Settings' SIDECARS panel — see
/// [`SidecarHealth`]'s doc comment for what each count means. Both counts
/// exclude rows with `missing_at` set, for the same reason as
/// [`list_tagged_media`]: a missing photo has no sidecar to write or
/// verify, so it should count toward neither "tagged" nor "pending".
pub(crate) async fn sidecar_health(pool: &SqlitePool, drive_id: i64) -> DpResult<SidecarHealth> {
    let tagged: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM media WHERE drive_id = ? \
         AND EXISTS (SELECT 1 FROM media_tags WHERE media_tags.media_id = media.id) \
         AND missing_at IS NULL",
    )
    .bind(drive_id)
    .fetch_one(pool)
    .await
    .map_err(db)?;

    let pending: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM media WHERE drive_id = ? \
         AND sidecar_pending = 1 AND missing_at IS NULL",
    )
    .bind(drive_id)
    .fetch_one(pool)
    .await
    .map_err(db)?;

    Ok(SidecarHealth {
        tagged: tagged as u64,
        pending: pending as u64,
    })
}
