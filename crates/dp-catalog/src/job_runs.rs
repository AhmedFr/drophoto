//! `job_runs`: one row per terminal run (done/cancelled/failed) of any job
//! kind — scan, organize, revert, sidecar sync, or geocode — recorded by
//! `dp_jobs::JobRunner` via [`Catalog::record_job_run`]. Unlike
//! `organize_jobs` (organize/revert only, tracked from creation through
//! completion so it can be reverted or shown "running"), this is a
//! write-once metrics log: nothing here is ever updated after insertion,
//! and it exists purely for the dashboard's "LAST RUNS" card.
//!
//! [`Catalog::record_job_run`]: crate::Catalog::record_job_run

use crate::sqlite::db;
use chrono::{DateTime, Utc};
use dp_core::{DpResult, JobRunRow, NewJobRun};
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};

fn parse_rfc3339(s: &str) -> DpResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .map_err(db)
}

fn row_to_job_run(row: &SqliteRow) -> DpResult<JobRunRow> {
    let ok: i64 = row.try_get("ok").map_err(db)?;
    let failed: i64 = row.try_get("failed").map_err(db)?;
    let skipped: i64 = row.try_get("skipped").map_err(db)?;
    let bytes_read: i64 = row.try_get("bytes_read").map_err(db)?;
    let bytes_written: i64 = row.try_get("bytes_written").map_err(db)?;
    let cpu_ms: i64 = row.try_get("cpu_ms").map_err(db)?;
    let started_at: String = row.try_get("started_at").map_err(db)?;
    let finished_at: String = row.try_get("finished_at").map_err(db)?;
    Ok(JobRunRow {
        id: row.try_get("id").map_err(db)?,
        job_id: row.try_get("job_id").map_err(db)?,
        kind: row.try_get("kind").map_err(db)?,
        drive_id: row.try_get("drive_id").map_err(db)?,
        status: row.try_get("status").map_err(db)?,
        ok: ok as u64,
        failed: failed as u64,
        skipped: skipped as u64,
        bytes_read: bytes_read as u64,
        bytes_written: bytes_written as u64,
        cpu_ms: cpu_ms as u64,
        started_at: parse_rfc3339(&started_at)?,
        finished_at: parse_rfc3339(&finished_at)?,
    })
}

pub(crate) async fn record_job_run(pool: &SqlitePool, run: NewJobRun) -> DpResult<()> {
    sqlx::query(
        "INSERT INTO job_runs \
         (job_id, kind, drive_id, status, ok, failed, skipped, bytes_read, bytes_written, cpu_ms, started_at, finished_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&run.job_id)
    .bind(&run.kind)
    .bind(run.drive_id)
    .bind(&run.status)
    .bind(run.ok as i64)
    .bind(run.failed as i64)
    .bind(run.skipped as i64)
    .bind(run.bytes_read as i64)
    .bind(run.bytes_written as i64)
    .bind(run.cpu_ms as i64)
    .bind(run.started_at.to_rfc3339())
    .bind(run.finished_at.to_rfc3339())
    .execute(pool)
    .await
    .map_err(db)?;
    Ok(())
}

/// The most recent `limit` job runs, newest first.
pub(crate) async fn list_job_runs(pool: &SqlitePool, limit: u32) -> DpResult<Vec<JobRunRow>> {
    let rows = sqlx::query("SELECT * FROM job_runs ORDER BY id DESC LIMIT ?")
        .bind(limit)
        .fetch_all(pool)
        .await
        .map_err(db)?;
    rows.iter().map(row_to_job_run).collect()
}
