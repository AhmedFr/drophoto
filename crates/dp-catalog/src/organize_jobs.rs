use crate::media::from_rfc3339;
use crate::sqlite::db;
use chrono::{DateTime, Utc};
use dp_core::{DpError, DpResult, OrganizeItemRow, OrganizeJobRow, PlanStatus};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};

fn status_to_str(s: PlanStatus) -> &'static str {
    match s {
        PlanStatus::Planned => "planned",
        PlanStatus::Moved => "moved",
        PlanStatus::SkippedDup => "skipped_dup",
        PlanStatus::SkippedCollision => "skipped_collision",
        PlanStatus::Failed => "failed",
    }
}

fn status_from_str(s: &str) -> DpResult<PlanStatus> {
    match s {
        "planned" => Ok(PlanStatus::Planned),
        "moved" => Ok(PlanStatus::Moved),
        "skipped_dup" => Ok(PlanStatus::SkippedDup),
        "skipped_collision" => Ok(PlanStatus::SkippedCollision),
        "failed" => Ok(PlanStatus::Failed),
        other => Err(DpError::Db {
            message: format!("invalid plan status: {other}"),
        }),
    }
}

fn row_to_job(row: &SqliteRow) -> DpResult<OrganizeJobRow> {
    let planned: i64 = row.try_get("planned").map_err(db)?;
    let moved: i64 = row.try_get("moved").map_err(db)?;
    let skipped: i64 = row.try_get("skipped").map_err(db)?;
    let failed: i64 = row.try_get("failed").map_err(db)?;
    let started_at: String = row.try_get("started_at").map_err(db)?;
    let finished_at: Option<String> = row.try_get("finished_at").map_err(db)?;
    Ok(OrganizeJobRow {
        id: row.try_get("id").map_err(db)?,
        drive_id: row.try_get("drive_id").map_err(db)?,
        drive_name: row.try_get("drive_name").map_err(db)?,
        status: row.try_get("status").map_err(db)?,
        planned: planned as u64,
        moved: moved as u64,
        skipped: skipped as u64,
        failed: failed as u64,
        started_at: DateTime::parse_from_rfc3339(&started_at)
            .map_err(db)?
            .with_timezone(&Utc),
        finished_at: from_rfc3339(finished_at)?,
        kind: row.try_get("kind").map_err(db)?,
        reverts_job_id: row.try_get("reverts_job_id").map_err(db)?,
        reverted_by_job_id: row.try_get("reverted_by_job_id").map_err(db)?,
    })
}

fn row_to_item(row: &SqliteRow) -> DpResult<OrganizeItemRow> {
    let status: String = row.try_get("status").map_err(db)?;
    Ok(OrganizeItemRow {
        id: row.try_get("id").map_err(db)?,
        job_id: row.try_get("job_id").map_err(db)?,
        media_id: row.try_get("media_id").map_err(db)?,
        old_rel_path: row.try_get("old_rel_path").map_err(db)?,
        new_rel_path: row.try_get("new_rel_path").map_err(db)?,
        status: status_from_str(&status)?,
        error: row.try_get("error").map_err(db)?,
    })
}

pub(crate) async fn create_organize_job(pool: &SqlitePool, drive_id: i64, planned: u64) -> DpResult<i64> {
    let now = Utc::now().to_rfc3339();
    let result = sqlx::query(
        "INSERT INTO organize_jobs (drive_id, status, planned, started_at) VALUES (?, 'running', ?, ?)",
    )
    .bind(drive_id)
    .bind(planned as i64)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(db)?;
    Ok(result.last_insert_rowid())
}

/// Creates a `revert` job row for `reverts_job_id`, mirroring
/// [`create_organize_job`] but stamping `kind = 'revert'` and recording
/// which organize job it reverts. `list_organize_jobs` surfaces the
/// reverse direction (`reverted_by_job_id`) on the reverted row via a
/// `LEFT JOIN` over this column.
pub(crate) async fn create_revert_job(
    pool: &SqlitePool,
    drive_id: i64,
    reverts_job_id: i64,
    planned: u64,
) -> DpResult<i64> {
    let now = Utc::now().to_rfc3339();
    let result = sqlx::query(
        "INSERT INTO organize_jobs (drive_id, status, planned, started_at, kind, reverts_job_id) \
         VALUES (?, 'running', ?, ?, 'revert', ?)",
    )
    .bind(drive_id)
    .bind(planned as i64)
    .bind(&now)
    .bind(reverts_job_id)
    .execute(pool)
    .await
    .map_err(db)?;
    Ok(result.last_insert_rowid())
}

pub(crate) async fn finish_organize_job(
    pool: &SqlitePool,
    id: i64,
    status: &str,
    moved: u64,
    skipped: u64,
    failed: u64,
) -> DpResult<()> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        "UPDATE organize_jobs SET status = ?, moved = ?, skipped = ?, failed = ?, finished_at = ? WHERE id = ?",
    )
    .bind(status)
    .bind(moved as i64)
    .bind(skipped as i64)
    .bind(failed as i64)
    .bind(&now)
    .bind(id)
    .execute(pool)
    .await
    .map_err(db)?;
    Ok(())
}

/// Closes out every `organize_jobs` row still marked `"running"`,
/// marking it `"failed"` and stamping `finished_at`. Called once when a
/// file-backed catalog is opened: a row can only be `"running"` at that
/// point if the process that owned it died (crash, force-quit, power
/// cut) without ever finishing it, and nothing will ever finish it now.
/// Returns how many rows were reconciled.
pub(crate) async fn fail_running_organize_jobs(pool: &SqlitePool) -> DpResult<u64> {
    let now = Utc::now().to_rfc3339();
    let result =
        sqlx::query("UPDATE organize_jobs SET status = 'failed', finished_at = ? WHERE status = 'running'")
            .bind(&now)
            .execute(pool)
            .await
            .map_err(db)?;
    Ok(result.rows_affected())
}

pub(crate) async fn insert_organize_item(pool: &SqlitePool, item: &OrganizeItemRow) -> DpResult<i64> {
    let result = sqlx::query(
        "INSERT INTO organize_items (job_id, media_id, old_rel_path, new_rel_path, status, error) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(item.job_id)
    .bind(item.media_id)
    .bind(&item.old_rel_path)
    .bind(&item.new_rel_path)
    .bind(status_to_str(item.status))
    .bind(&item.error)
    .execute(pool)
    .await
    .map_err(db)?;
    Ok(result.last_insert_rowid())
}

/// The subquery behind `reverted_by_job_id`: per organize job, the
/// *newest* **successful** (`status = 'done'`) revert job that
/// references it (`MAX(id)` grouped by `reverts_job_id`). A `failed` or
/// `cancelled` revert must never block a retry (see `RevertJob::run_inner`
/// — a revert with any failed item finishes `"failed"`, not `"done"`),
/// so only a `done` revert counts here.
const REVERTED_BY_SUBQUERY: &str = "SELECT reverts_job_id, MAX(id) AS id FROM organize_jobs \
     WHERE kind = 'revert' AND status = 'done' GROUP BY reverts_job_id";

pub(crate) async fn list_organize_jobs(pool: &SqlitePool, limit: u32) -> DpResult<Vec<OrganizeJobRow>> {
    let sql = format!(
        "SELECT j.*, d.name AS drive_name, r.id AS reverted_by_job_id \
         FROM organize_jobs j \
         JOIN drives d ON d.id = j.drive_id \
         LEFT JOIN ({REVERTED_BY_SUBQUERY}) r ON r.reverts_job_id = j.id \
         ORDER BY j.id DESC LIMIT ?",
    );
    let rows = sqlx::query(&sql).bind(limit).fetch_all(pool).await.map_err(db)?;
    rows.iter().map(row_to_job).collect()
}

/// A single `organize_jobs` row by id, or `None` if it doesn't exist.
/// Same shape (and the same `reverted_by_job_id` computation) as
/// [`list_organize_jobs`], just addressed by id instead of listed —
/// what `revert_organize` uses to load the job it's about to revert
/// without scanning the whole recent-jobs list.
pub(crate) async fn get_organize_job(pool: &SqlitePool, id: i64) -> DpResult<Option<OrganizeJobRow>> {
    let sql = format!(
        "SELECT j.*, d.name AS drive_name, r.id AS reverted_by_job_id \
         FROM organize_jobs j \
         JOIN drives d ON d.id = j.drive_id \
         LEFT JOIN ({REVERTED_BY_SUBQUERY}) r ON r.reverts_job_id = j.id \
         WHERE j.id = ?",
    );
    let row = sqlx::query(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await
        .map_err(db)?;
    row.as_ref().map(row_to_job).transpose()
}

pub(crate) async fn list_organize_items(
    pool: &SqlitePool,
    job_id: i64,
    limit: u32,
) -> DpResult<Vec<OrganizeItemRow>> {
    let rows = sqlx::query("SELECT * FROM organize_items WHERE job_id = ? ORDER BY id LIMIT ?")
        .bind(job_id)
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(db)?;
    rows.iter().map(row_to_item).collect()
}
