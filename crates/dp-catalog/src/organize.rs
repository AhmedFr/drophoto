use crate::media::{from_rfc3339, row_to_media};
use crate::sqlite::db;
use dp_core::{DpResult, MediaRow, OrganizeRule, UnorganizedSummary};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};
use std::collections::HashSet;

/// True when `rel_path` sits directly under `<root>/`. Deliberately built
/// from `substr`/`length` rather than `LIKE` — `LIKE` treats `_` and `%` in
/// `root` as wildcards, which would misclassify a literal root such as
/// `my_archive` or `100%`. Bind `root` twice, once for each `?`.
const UNDER_ROOT_PREDICATE: &str = "substr(rel_path, 1, length(?) + 1) = ? || '/'";

fn row_to_rule(row: &SqliteRow) -> DpResult<OrganizeRule> {
    let keep_pairs: i64 = row.try_get("keep_pairs").map_err(db)?;
    Ok(OrganizeRule {
        drive_id: row.try_get("drive_id").map_err(db)?,
        root: row.try_get("root").map_err(db)?,
        folder_tpl: row.try_get("folder_tpl").map_err(db)?,
        file_tpl: row.try_get("file_tpl").map_err(db)?,
        keep_pairs: keep_pairs != 0,
    })
}

pub(crate) async fn get_rule(pool: &SqlitePool, drive_id: i64) -> DpResult<OrganizeRule> {
    let row = sqlx::query("SELECT * FROM organize_rules WHERE drive_id = ?")
        .bind(drive_id)
        .fetch_optional(pool)
        .await
        .map_err(db)?;
    match row {
        Some(r) => row_to_rule(&r),
        None => Ok(OrganizeRule::default_for(drive_id)),
    }
}

pub(crate) async fn save_rule(pool: &SqlitePool, r: &OrganizeRule) -> DpResult<()> {
    sqlx::query(
        "INSERT INTO organize_rules (drive_id, root, folder_tpl, file_tpl, keep_pairs) VALUES (?, ?, ?, ?, ?) \
         ON CONFLICT(drive_id) DO UPDATE SET root=excluded.root, folder_tpl=excluded.folder_tpl, \
         file_tpl=excluded.file_tpl, keep_pairs=excluded.keep_pairs",
    )
    .bind(r.drive_id)
    .bind(&r.root)
    .bind(&r.folder_tpl)
    .bind(&r.file_tpl)
    .bind(r.keep_pairs as i64)
    .execute(pool)
    .await
    .map_err(db)?;
    Ok(())
}

pub(crate) async fn list_unorganized(
    pool: &SqlitePool,
    drive_id: i64,
    root: &str,
) -> DpResult<Vec<MediaRow>> {
    let sql = format!(
        "SELECT * FROM media WHERE drive_id = ? AND organized_at IS NULL AND NOT ({UNDER_ROOT_PREDICATE}) \
         ORDER BY id",
    );
    let rows = sqlx::query(&sql)
        .bind(drive_id)
        .bind(root)
        .bind(root)
        .fetch_all(pool)
        .await
        .map_err(db)?;
    rows.iter().map(row_to_media).collect()
}

pub(crate) async fn unorganized_summary(
    pool: &SqlitePool,
    drive_id: i64,
    root: &str,
) -> DpResult<UnorganizedSummary> {
    let sql = format!(
        "SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes, \
         COALESCE(SUM(kind = 'photo'), 0) AS photos, COALESCE(SUM(kind = 'video'), 0) AS videos, \
         MIN(taken_at) AS earliest, MAX(taken_at) AS latest \
         FROM media WHERE drive_id = ? AND organized_at IS NULL AND NOT ({UNDER_ROOT_PREDICATE})",
    );
    let row = sqlx::query(&sql)
        .bind(drive_id)
        .bind(root)
        .bind(root)
        .fetch_one(pool)
        .await
        .map_err(db)?;
    let count: i64 = row.try_get("count").map_err(db)?;
    let bytes: i64 = row.try_get("bytes").map_err(db)?;
    let photos: i64 = row.try_get("photos").map_err(db)?;
    let videos: i64 = row.try_get("videos").map_err(db)?;
    let earliest: Option<String> = row.try_get("earliest").map_err(db)?;
    let latest: Option<String> = row.try_get("latest").map_err(db)?;
    Ok(UnorganizedSummary {
        drive_id,
        count: count as u64,
        bytes: bytes as u64,
        photos: photos as u64,
        videos: videos as u64,
        earliest: from_rfc3339(earliest)?,
        latest: from_rfc3339(latest)?,
    })
}

pub(crate) async fn organized_hashes(pool: &SqlitePool, hashes: &[String]) -> DpResult<HashSet<String>> {
    let mut result = HashSet::new();
    for chunk in hashes.chunks(500) {
        if chunk.is_empty() {
            continue;
        }
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT DISTINCT hash FROM media WHERE organized_at IS NOT NULL AND hash IN ({placeholders})"
        );
        let mut q = sqlx::query(&sql);
        for h in chunk {
            q = q.bind(h);
        }
        let rows = q.fetch_all(pool).await.map_err(db)?;
        for row in rows {
            let h: String = row.try_get("hash").map_err(db)?;
            result.insert(h);
        }
    }
    Ok(result)
}

pub(crate) async fn list_rel_paths(pool: &SqlitePool, drive_id: i64) -> DpResult<Vec<String>> {
    let rows = sqlx::query("SELECT rel_path FROM media WHERE drive_id = ?")
        .bind(drive_id)
        .fetch_all(pool)
        .await
        .map_err(db)?;
    rows.iter().map(|r| r.try_get("rel_path").map_err(db)).collect()
}

pub(crate) async fn mark_media_organized(
    pool: &SqlitePool,
    media_id: i64,
    new_rel_path: &str,
) -> DpResult<()> {
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query("UPDATE media SET rel_path = ?, organized_at = ? WHERE id = ?")
        .bind(new_rel_path)
        .bind(&now)
        .bind(media_id)
        .execute(pool)
        .await
        .map_err(db)?;
    Ok(())
}
