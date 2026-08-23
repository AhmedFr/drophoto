//! Per-drive scan sources: the `sources` table, listing/upserting/enabling
//! them, and the `media.source_id IS NULL` count used to flag rows scanned
//! before sources existed.

use crate::sqlite::db;
use dp_core::{DpResult, NewSource, Source};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};

fn row_to_source(row: &SqliteRow) -> DpResult<Source> {
    let enabled: i64 = row.try_get("enabled").map_err(db)?;
    Ok(Source {
        id: row.try_get("id").map_err(db)?,
        drive_id: row.try_get("drive_id").map_err(db)?,
        rel_path: row.try_get("rel_path").map_err(db)?,
        enabled: enabled != 0,
    })
}

pub(crate) async fn list_sources(pool: &SqlitePool, drive_id: i64) -> DpResult<Vec<Source>> {
    let rows = sqlx::query("SELECT * FROM sources WHERE drive_id = ? ORDER BY rel_path")
        .bind(drive_id)
        .fetch_all(pool)
        .await
        .map_err(db)?;
    rows.iter().map(row_to_source).collect()
}

pub(crate) async fn list_enabled_sources(pool: &SqlitePool, drive_id: i64) -> DpResult<Vec<Source>> {
    let rows = sqlx::query("SELECT * FROM sources WHERE drive_id = ? AND enabled = 1 ORDER BY rel_path")
        .bind(drive_id)
        .fetch_all(pool)
        .await
        .map_err(db)?;
    rows.iter().map(row_to_source).collect()
}

/// Inserts a new source for `s.drive_id`/`s.rel_path`, or, if one already
/// exists for that pair, re-enables it (a previously-deleted-in-spirit but
/// merely-disabled source is simply turned back on rather than
/// duplicated).
pub(crate) async fn upsert_source(pool: &SqlitePool, s: NewSource) -> DpResult<Source> {
    sqlx::query(
        "INSERT INTO sources (drive_id, rel_path, enabled) VALUES (?, ?, 1) \
         ON CONFLICT(drive_id, rel_path) DO UPDATE SET enabled = 1",
    )
    .bind(s.drive_id)
    .bind(&s.rel_path)
    .execute(pool)
    .await
    .map_err(db)?;

    let row = sqlx::query("SELECT * FROM sources WHERE drive_id = ? AND rel_path = ?")
        .bind(s.drive_id)
        .bind(&s.rel_path)
        .fetch_one(pool)
        .await
        .map_err(db)?;
    row_to_source(&row)
}

pub(crate) async fn set_source_enabled(pool: &SqlitePool, id: i64, enabled: bool) -> DpResult<()> {
    sqlx::query("UPDATE sources SET enabled = ? WHERE id = ?")
        .bind(enabled as i64)
        .bind(id)
        .execute(pool)
        .await
        .map_err(db)?;
    Ok(())
}

pub(crate) async fn delete_source(pool: &SqlitePool, id: i64) -> DpResult<()> {
    sqlx::query("DELETE FROM sources WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(db)?;
    Ok(())
}

/// Count of media rows for `drive_id` that were never attributed to a
/// source (scanned before sources existed, or otherwise unattributed).
pub(crate) async fn count_media_without_source(pool: &SqlitePool, drive_id: i64) -> DpResult<u64> {
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM media WHERE drive_id = ? AND source_id IS NULL")
            .bind(drive_id)
            .fetch_one(pool)
            .await
            .map_err(db)?;
    Ok(count as u64)
}
