//! Read paths that serve the gallery's timeline: the undated-row helpers
//! behind filename date recovery, and (see `media_index`) the compact
//! whole-set index the grid's layout and date scrubber are built from.

use chrono::{DateTime, Utc};
use dp_core::{DpResult, MediaIndexEntry, MediaQuery};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};

use crate::media::to_rfc3339;
use crate::sqlite::db;

/// How many `media` rows currently have no `taken_at` — the number the
/// Settings action offers to recover.
pub(crate) async fn count_undated(pool: &SqlitePool) -> DpResult<u64> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM media WHERE taken_at IS NULL")
        .fetch_one(pool)
        .await
        .map_err(db)?;
    Ok(count as u64)
}

/// `(id, rel_path)` for up to `limit` rows with `taken_at IS NULL` and
/// `id > after_id`, ordered by id.
///
/// Cursor-paginated by `id` rather than offset-paginated — same reasoning
/// as [`crate::places::list_ungeocoded`]: `after_id` (`0` for the first
/// page) plus `id > ?, ORDER BY id LIMIT ?` means a row that gains a date
/// between pages (and so drops out of this predicate) can never shift a
/// later page's window and cause a not-yet-seen row to be skipped. This
/// is what lets `recover_filename_dates` advance past a batch that parsed
/// nothing instead of re-fetching the same stuck lowest-id rows forever —
/// an `OFFSET` would be wrong here for the identical reason.
pub(crate) async fn list_undated(
    pool: &SqlitePool,
    after_id: i64,
    limit: u32,
) -> DpResult<Vec<(i64, String)>> {
    let rows =
        sqlx::query("SELECT id, rel_path FROM media WHERE taken_at IS NULL AND id > ? ORDER BY id LIMIT ?")
            .bind(after_id)
            .bind(limit)
            .fetch_all(pool)
            .await
            .map_err(db)?;
    rows.iter()
        .map(|r| {
            let id: i64 = r.try_get("id").map_err(db)?;
            let rel_path: String = r.try_get("rel_path").map_err(db)?;
            Ok((id, rel_path))
        })
        .collect()
}

/// Writes recovered dates in one transaction. The `taken_at IS NULL`
/// guard is in the statement itself, not just the caller's selection: a
/// scan finishing mid-recovery could have written a real EXIF date since
/// `list_undated` ran, and that date must win — this never overwrites it.
pub(crate) async fn set_taken_at_bulk(pool: &SqlitePool, rows: &[(i64, DateTime<Utc>)]) -> DpResult<u64> {
    if rows.is_empty() {
        return Ok(0);
    }
    let mut tx = pool.begin().await.map_err(db)?;
    let mut changed = 0u64;
    for (id, taken_at) in rows {
        let result = sqlx::query("UPDATE media SET taken_at = ? WHERE id = ? AND taken_at IS NULL")
            .bind(to_rfc3339(Some(*taken_at)))
            .bind(id)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
        changed += result.rows_affected();
    }
    tx.commit().await.map_err(db)?;
    Ok(changed)
}

fn row_to_index_entry(row: &SqliteRow) -> DpResult<MediaIndexEntry> {
    let kind: String = row.try_get("kind").map_err(db)?;
    let width: Option<i64> = row.try_get("width").map_err(db)?;
    let height: Option<i64> = row.try_get("height").map_err(db)?;
    Ok(MediaIndexEntry {
        id: row.try_get("id").map_err(db)?,
        taken_at: row.try_get("taken_at").map_err(db)?,
        width: width.map(|w| w as u32),
        height: height.map(|h| h as u32),
        kind: crate::media::kind_from_str(&kind)?,
    })
}

/// Every row matching `q`, in `q`'s sort order, as compact index entries.
/// `q.limit`/`q.offset` are deliberately ignored: the caller wants the
/// whole set, and the same `MediaQuery` is reused for paged hydration.
///
/// Composes the exact same `where_clause`/`order_by` SQL `query_media`
/// uses (never duplicated) — the guarantee this exists for is that index
/// position N is the same row `query_media` returns at `offset = N`; any
/// divergence between the two would put a hydrated tile in the wrong
/// place in the gallery.
pub(crate) async fn media_index(pool: &SqlitePool, q: &MediaQuery) -> DpResult<Vec<MediaIndexEntry>> {
    let (where_sql, args) = crate::query::where_clause(q);
    let sql = format!(
        "SELECT m.id, m.taken_at, m.width, m.height, m.kind FROM media m {where_sql} {}",
        crate::query::order_by(q.sort)
    );
    let rows = sqlx::query_with(&sql, args).fetch_all(pool).await.map_err(db)?;
    rows.iter().map(row_to_index_entry).collect()
}
