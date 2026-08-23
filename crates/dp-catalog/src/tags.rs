//! User-defined tags on media rows: the `tags`/`media_tags` tables, and the
//! `sidecar_pending` flag on `media` that tracks when a row's tag set has
//! changed since its sidecar file was last written.

use crate::media::row_to_media;
use crate::sqlite::db;
use dp_core::{DpResult, MediaRow, Tag};
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
