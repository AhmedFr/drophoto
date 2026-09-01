use crate::sqlite::db;
use chrono::{DateTime, NaiveDateTime, Utc};
use dp_core::{
    DpError, DpResult, MediaKind, MediaMetadata, MediaRow, NewMedia, ScanErrorCodeCount, ScanErrorRow,
    ScanIndexEntry,
};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};

fn kind_to_str(kind: MediaKind) -> &'static str {
    match kind {
        MediaKind::Photo => "photo",
        MediaKind::Video => "video",
    }
}

fn kind_from_str(s: &str) -> DpResult<MediaKind> {
    match s {
        "photo" => Ok(MediaKind::Photo),
        "video" => Ok(MediaKind::Video),
        other => Err(DpError::Db {
            message: format!("invalid media kind: {other}"),
        }),
    }
}

pub(crate) fn to_rfc3339(dt: Option<DateTime<Utc>>) -> Option<String> {
    dt.map(|d| d.to_rfc3339())
}

pub(crate) fn from_rfc3339(s: Option<String>) -> DpResult<Option<DateTime<Utc>>> {
    s.map(|s| DateTime::parse_from_rfc3339(&s).map(|d| d.with_timezone(&Utc)))
        .transpose()
        .map_err(db)
}

pub(crate) fn row_to_media(row: &SqliteRow) -> DpResult<MediaRow> {
    let kind: String = row.try_get("kind").map_err(db)?;
    let taken_at: Option<String> = row.try_get("taken_at").map_err(db)?;
    let missing_at: Option<String> = row.try_get("missing_at").map_err(db)?;
    let organized_at: Option<String> = row.try_get("organized_at").map_err(db)?;
    let mtime: Option<String> = row.try_get("mtime").map_err(db)?;
    let size: i64 = row.try_get("size").map_err(db)?;
    let width: Option<i64> = row.try_get("width").map_err(db)?;
    let height: Option<i64> = row.try_get("height").map_err(db)?;
    let duration_ms: Option<i64> = row.try_get("duration_ms").map_err(db)?;
    let iso: Option<i64> = row.try_get("iso").map_err(db)?;
    let sidecar_pending: i64 = row.try_get("sidecar_pending").map_err(db)?;
    Ok(MediaRow {
        id: row.try_get("id").map_err(db)?,
        drive_id: row.try_get("drive_id").map_err(db)?,
        rel_path: row.try_get("rel_path").map_err(db)?,
        hash: row.try_get("hash").map_err(db)?,
        size: size as u64,
        kind: kind_from_str(&kind)?,
        ext: row.try_get("ext").map_err(db)?,
        width: width.map(|w| w as u32),
        height: height.map(|h| h as u32),
        duration_ms: duration_ms.map(|d| d as u64),
        taken_at: from_rfc3339(taken_at)?,
        camera: row.try_get("camera").map_err(db)?,
        lens: row.try_get("lens").map_err(db)?,
        aperture: row.try_get("aperture").map_err(db)?,
        shutter: row.try_get("shutter").map_err(db)?,
        iso: iso.map(|i| i as u32),
        focal_mm: row.try_get("focal_mm").map_err(db)?,
        lat: row.try_get("lat").map_err(db)?,
        lon: row.try_get("lon").map_err(db)?,
        missing_at: from_rfc3339(missing_at)?,
        organized_at: from_rfc3339(organized_at)?,
        source_id: row.try_get("source_id").map_err(db)?,
        sidecar_pending: sidecar_pending != 0,
        place_id: row.try_get("place_id").map_err(db)?,
        mtime: from_rfc3339(mtime)?,
    })
}

pub(crate) async fn upsert_media(pool: &SqlitePool, m: NewMedia) -> DpResult<i64> {
    sqlx::query(
        "INSERT INTO media (drive_id, rel_path, hash, size, kind, ext, width, height, duration_ms, \
         taken_at, camera, lens, aperture, shutter, iso, focal_mm, lat, lon, organized_at, source_id, mtime) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(drive_id, rel_path) DO UPDATE SET \
         hash=excluded.hash, size=excluded.size, kind=excluded.kind, ext=excluded.ext, \
         width=excluded.width, height=excluded.height, duration_ms=excluded.duration_ms, \
         taken_at=excluded.taken_at, camera=excluded.camera, lens=excluded.lens, \
         aperture=excluded.aperture, shutter=excluded.shutter, iso=excluded.iso, \
         focal_mm=excluded.focal_mm, lat=excluded.lat, lon=excluded.lon, missing_at=NULL, \
         organized_at=COALESCE(media.organized_at, excluded.organized_at), \
         source_id=COALESCE(excluded.source_id, media.source_id), mtime=excluded.mtime",
    )
    .bind(m.drive_id)
    .bind(&m.rel_path)
    .bind(&m.hash)
    .bind(m.size as i64)
    .bind(kind_to_str(m.kind))
    .bind(&m.ext)
    .bind(m.width.map(|w| w as i64))
    .bind(m.height.map(|h| h as i64))
    .bind(m.duration_ms.map(|d| d as i64))
    .bind(to_rfc3339(m.taken_at))
    .bind(&m.camera)
    .bind(&m.lens)
    .bind(m.aperture)
    .bind(m.shutter)
    .bind(m.iso.map(|i| i as i64))
    .bind(m.focal_mm)
    .bind(m.lat)
    .bind(m.lon)
    .bind(to_rfc3339(m.organized_at))
    .bind(m.source_id)
    .bind(to_rfc3339(m.mtime))
    .execute(pool)
    .await
    .map_err(db)?;

    let row = sqlx::query("SELECT id FROM media WHERE drive_id = ? AND rel_path = ?")
        .bind(m.drive_id)
        .bind(&m.rel_path)
        .fetch_one(pool)
        .await
        .map_err(db)?;
    let id: i64 = row.try_get("id").map_err(db)?;

    // FTS is derived data — never fail the write over a sync problem.
    if let Err(e) = crate::fts::sync_fts(pool, id).await {
        tracing::warn!(media_id = id, error = %e, "failed to sync FTS index after upsert_media");
    }

    Ok(id)
}

pub(crate) async fn list_media(pool: &SqlitePool, limit: u32, offset: u32) -> DpResult<Vec<MediaRow>> {
    let rows = sqlx::query("SELECT * FROM media ORDER BY taken_at DESC NULLS LAST, id DESC LIMIT ? OFFSET ?")
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await
        .map_err(db)?;
    rows.into_iter().map(|r| row_to_media(&r)).collect()
}

pub(crate) async fn count_media(pool: &SqlitePool, drive_id: Option<i64>) -> DpResult<u64> {
    let count: i64 = match drive_id {
        Some(id) => sqlx::query_scalar("SELECT COUNT(*) FROM media WHERE drive_id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .map_err(db)?,
        None => sqlx::query_scalar("SELECT COUNT(*) FROM media")
            .fetch_one(pool)
            .await
            .map_err(db)?,
    };
    Ok(count as u64)
}

/// Every media row on `drive_id` that was never attributed to a source
/// (`source_id IS NULL` — scanned before sources existed). Ordered by
/// id so callers see a stable sequence.
pub(crate) async fn list_media_without_source(pool: &SqlitePool, drive_id: i64) -> DpResult<Vec<MediaRow>> {
    let rows = sqlx::query("SELECT * FROM media WHERE drive_id = ? AND source_id IS NULL ORDER BY id")
        .bind(drive_id)
        .fetch_all(pool)
        .await
        .map_err(db)?;
    rows.iter().map(row_to_media).collect()
}

/// Deletes media row `id`, but **only** when no `organize_items` row
/// references it, returning whether it was actually deleted.
///
/// `organize_items.media_id` carries no foreign key, so nothing at the
/// schema level stops a delete from stranding a finished job's history
/// — and a stranded item is exactly what would make that job
/// un-revertable (`RevertJob` looks the media row back up by id). The
/// `NOT EXISTS` guard lives inside the statement rather than in a
/// read-then-delete pair so the check and the delete can't race.
pub(crate) async fn delete_media(pool: &SqlitePool, id: i64) -> DpResult<bool> {
    let result = sqlx::query(
        "DELETE FROM media WHERE id = ? \
         AND NOT EXISTS (SELECT 1 FROM organize_items WHERE organize_items.media_id = media.id)",
    )
    .bind(id)
    .execute(pool)
    .await
    .map_err(db)?;
    let deleted = result.rows_affected() > 0;

    if deleted {
        // FTS is derived data — never fail the write over a sync problem.
        if let Err(e) = crate::fts::sync_fts(pool, id).await {
            tracing::warn!(media_id = id, error = %e, "failed to sync FTS index after delete_media");
        }
    }

    Ok(deleted)
}

/// Every media row on `drive_id`'s identity/fingerprint for the
/// incremental-rescan skip check — one query for the whole drive, meant to
/// be loaded into a `HashMap<rel_path, ScanIndexEntry>` before a scan's
/// walk starts. See [`ScanIndexEntry`].
pub(crate) async fn list_scan_index(pool: &SqlitePool, drive_id: i64) -> DpResult<Vec<ScanIndexEntry>> {
    let rows = sqlx::query(
        "SELECT id, rel_path, size, mtime, hash, source_id, sidecar_mtime, meta_read_at \
         FROM media WHERE drive_id = ?",
    )
    .bind(drive_id)
    .fetch_all(pool)
    .await
    .map_err(db)?;
    rows.iter()
        .map(|r| {
            let size: i64 = r.try_get("size").map_err(db)?;
            let mtime: Option<String> = r.try_get("mtime").map_err(db)?;
            let sidecar_mtime: Option<String> = r.try_get("sidecar_mtime").map_err(db)?;
            let meta_read_at: Option<String> = r.try_get("meta_read_at").map_err(db)?;
            Ok(ScanIndexEntry {
                id: r.try_get("id").map_err(db)?,
                rel_path: r.try_get("rel_path").map_err(db)?,
                size: size as u64,
                mtime: from_rfc3339(mtime)?,
                hash: r.try_get("hash").map_err(db)?,
                source_id: r.try_get("source_id").map_err(db)?,
                sidecar_mtime: from_rfc3339(sidecar_mtime)?,
                meta_read_at: from_rfc3339(meta_read_at)?,
            })
        })
        .collect()
}

/// Updates media row `id`'s metadata columns (everything
/// [`MediaMetadata`] carries) plus `meta_read_at`, then syncs its FTS row
/// (log-only, like every other write in this module — FTS is derived
/// data, never a reason to fail the write). Called by `dp_jobs::ScanJob`
/// both right after a fresh upsert whose metadata read succeeded, and by
/// the incremental-rescan metadata-backfill path for a skip-eligible row
/// whose `meta_read_at` is still `NULL` — see [`ScanIndexEntry::meta_read_at`].
///
/// Deliberately narrower than [`upsert_media`]: it never touches
/// `hash`/`size`/`kind`/`ext`/`mtime`/`source_id`/`organized_at` — only
/// the metadata columns exiftool/ffmpeg actually produce, so it's safe to
/// call on a row the backfill path never re-hashed or re-thumbnailed.
pub(crate) async fn update_media_metadata(
    pool: &SqlitePool,
    id: i64,
    m: &MediaMetadata,
    read_at: DateTime<Utc>,
) -> DpResult<()> {
    sqlx::query(
        "UPDATE media SET width=?, height=?, duration_ms=?, taken_at=?, camera=?, lens=?, \
         aperture=?, shutter=?, iso=?, focal_mm=?, lat=?, lon=?, meta_read_at=? WHERE id=?",
    )
    .bind(m.width.map(|w| w as i64))
    .bind(m.height.map(|h| h as i64))
    .bind(m.duration_ms.map(|d| d as i64))
    .bind(to_rfc3339(m.taken_at))
    .bind(&m.camera)
    .bind(&m.lens)
    .bind(m.aperture)
    .bind(m.shutter)
    .bind(m.iso.map(|i| i as i64))
    .bind(m.focal_mm)
    .bind(m.lat)
    .bind(m.lon)
    .bind(to_rfc3339(Some(read_at)))
    .bind(id)
    .execute(pool)
    .await
    .map_err(db)?;

    // FTS is derived data — never fail the write over a sync problem.
    if let Err(e) = crate::fts::sync_fts(pool, id).await {
        tracing::warn!(media_id = id, error = %e, "failed to sync FTS index after update_media_metadata");
    }

    Ok(())
}

/// Records the XMP sidecar's on-disk mtime as of the last time it was
/// actually read (a scan importing subjects from it, or `SidecarSyncJob`
/// writing it) — the incremental-rescan skip path's baseline for "has this
/// sidecar changed since we last looked at it". See
/// [`dp_core::ScanIndexEntry::sidecar_mtime`].
pub(crate) async fn set_sidecar_mtime(
    pool: &SqlitePool,
    media_id: i64,
    mtime: DateTime<Utc>,
) -> DpResult<()> {
    sqlx::query("UPDATE media SET sidecar_mtime = ? WHERE id = ?")
        .bind(to_rfc3339(Some(mtime)))
        .bind(media_id)
        .execute(pool)
        .await
        .map_err(db)?;
    Ok(())
}

pub(crate) async fn media_hash_exists(pool: &SqlitePool, hash: &str) -> DpResult<bool> {
    let exists: i64 = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM media WHERE hash = ?)")
        .bind(hash)
        .fetch_one(pool)
        .await
        .map_err(db)?;
    Ok(exists != 0)
}

pub(crate) async fn record_scan_error(
    pool: &SqlitePool,
    drive_id: i64,
    path: &str,
    code: &str,
    message: &str,
) -> DpResult<()> {
    sqlx::query("INSERT INTO scan_errors (drive_id, path, code, message) VALUES (?, ?, ?, ?)")
        .bind(drive_id)
        .bind(path)
        .bind(code)
        .bind(message)
        .execute(pool)
        .await
        .map_err(db)?;
    Ok(())
}

/// How many `scan_errors` rows `drive_id` currently has — backs both the
/// "Errors…" drive-actions dropdown item (only shown once this is nonzero)
/// and [`crate::forget_drive::forget_drive`]'s cascade test, which proves
/// its `DELETE FROM scan_errors` actually runs.
pub(crate) async fn count_scan_errors(pool: &SqlitePool, drive_id: i64) -> DpResult<u64> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM scan_errors WHERE drive_id = ?")
        .bind(drive_id)
        .fetch_one(pool)
        .await
        .map_err(db)?;
    Ok(count as u64)
}

/// Parses SQLite's `datetime('now')` default format (`"YYYY-MM-DD
/// HH:MM:SS"`, UTC, no offset) — what `scan_errors.at` actually stores,
/// unlike the app-written RFC3339 timestamps ([`to_rfc3339`]/
/// [`from_rfc3339`]) most other datetime columns in this crate use.
fn parse_sqlite_datetime(s: &str) -> DpResult<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
        .map(|naive| naive.and_utc())
        .map_err(db)
}

fn row_to_scan_error(row: &SqliteRow) -> DpResult<ScanErrorRow> {
    let id: i64 = row.try_get("id").map_err(db)?;
    let drive_id: i64 = row.try_get("drive_id").map_err(db)?;
    let path: String = row.try_get("path").map_err(db)?;
    let code: String = row.try_get("code").map_err(db)?;
    let message: String = row.try_get("message").map_err(db)?;
    let at: String = row.try_get("at").map_err(db)?;
    Ok(ScanErrorRow {
        id,
        drive_id,
        path,
        code,
        message,
        at: parse_sqlite_datetime(&at)?,
    })
}

/// Pages `drive_id`'s `scan_errors` rows, newest first (`id DESC` — more
/// reliable than ordering by `at`, since a fast scan can record many rows
/// within the same wall-clock second) — backs `ScanErrorsDialog`'s "Load
/// more" paging.
pub(crate) async fn list_scan_errors(
    pool: &SqlitePool,
    drive_id: i64,
    limit: u32,
    offset: u32,
) -> DpResult<Vec<ScanErrorRow>> {
    let rows = sqlx::query(
        "SELECT id, drive_id, path, code, message, at FROM scan_errors \
         WHERE drive_id = ? ORDER BY id DESC LIMIT ? OFFSET ?",
    )
    .bind(drive_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await
    .map_err(db)?;
    rows.iter().map(row_to_scan_error).collect()
}

/// `drive_id`'s `scan_errors` rows grouped by `code`, ordered `count DESC`
/// — the severity repartition `ScanProgress`'s failed-count hover card and
/// `ScanErrorsDialog`'s header derive their per-severity counts from (see
/// `dp_core::ScanErrorCodeCount`).
pub(crate) async fn scan_error_code_counts(
    pool: &SqlitePool,
    drive_id: i64,
) -> DpResult<Vec<ScanErrorCodeCount>> {
    let rows = sqlx::query(
        "SELECT code, COUNT(*) as count FROM scan_errors WHERE drive_id = ? \
         GROUP BY code ORDER BY count DESC",
    )
    .bind(drive_id)
    .fetch_all(pool)
    .await
    .map_err(db)?;
    rows.iter()
        .map(|row| {
            let code: String = row.try_get("code").map_err(db)?;
            let count: i64 = row.try_get("count").map_err(db)?;
            Ok(ScanErrorCodeCount {
                code,
                count: count as u64,
            })
        })
        .collect()
}
