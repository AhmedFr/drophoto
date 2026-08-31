use chrono::{DateTime, Utc};
use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::NewJobRun;

fn ts(s: &str) -> DateTime<Utc> {
    format!("{s}Z").parse().expect("fixed test timestamp must parse")
}

fn run(
    job_id: &str,
    kind: &str,
    drive_id: Option<i64>,
    status: &str,
    started: &str,
    finished: &str,
) -> NewJobRun {
    NewJobRun {
        job_id: job_id.into(),
        kind: kind.into(),
        drive_id,
        status: status.into(),
        ok: 3,
        failed: 1,
        skipped: 2,
        bytes_read: 1024,
        bytes_written: 512,
        cpu_ms: 42,
        started_at: ts(started),
        finished_at: ts(finished),
    }
}

#[tokio::test]
async fn record_and_list_round_trips_every_field() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();

    c.record_job_run(run(
        "scan-1",
        "scan",
        Some(7),
        "done",
        "2026-01-01T10:00:00",
        "2026-01-01T10:05:00",
    ))
    .await
    .unwrap();

    let runs = c.list_job_runs(10).await.unwrap();
    assert_eq!(runs.len(), 1);
    let row = &runs[0];
    assert_eq!(row.job_id, "scan-1");
    assert_eq!(row.kind, "scan");
    assert_eq!(row.drive_id, Some(7));
    assert_eq!(row.status, "done");
    assert_eq!(row.ok, 3);
    assert_eq!(row.failed, 1);
    assert_eq!(row.skipped, 2);
    assert_eq!(row.bytes_read, 1024);
    assert_eq!(row.bytes_written, 512);
    assert_eq!(row.cpu_ms, 42);
    assert_eq!(row.started_at, ts("2026-01-01T10:00:00"));
    assert_eq!(row.finished_at, ts("2026-01-01T10:05:00"));
}

#[tokio::test]
async fn a_global_job_records_a_null_drive_id() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();

    c.record_job_run(run(
        "geocode-0",
        "geocode",
        None,
        "done",
        "2026-01-01T10:00:00",
        "2026-01-01T10:05:00",
    ))
    .await
    .unwrap();

    let runs = c.list_job_runs(10).await.unwrap();
    assert_eq!(runs[0].drive_id, None);
}

#[tokio::test]
async fn list_job_runs_orders_newest_first() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();

    for i in 0..3 {
        c.record_job_run(run(
            &format!("scan-{i}"),
            "scan",
            Some(1),
            "done",
            "2026-01-01T10:00:00",
            "2026-01-01T10:05:00",
        ))
        .await
        .unwrap();
    }

    let runs = c.list_job_runs(10).await.unwrap();
    let ids: Vec<&str> = runs.iter().map(|r| r.job_id.as_str()).collect();
    assert_eq!(ids, vec!["scan-2", "scan-1", "scan-0"]);
}

#[tokio::test]
async fn list_job_runs_respects_the_limit() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();

    for i in 0..5 {
        c.record_job_run(run(
            &format!("scan-{i}"),
            "scan",
            Some(1),
            "done",
            "2026-01-01T10:00:00",
            "2026-01-01T10:05:00",
        ))
        .await
        .unwrap();
    }

    let runs = c.list_job_runs(2).await.unwrap();
    assert_eq!(runs.len(), 2);
    let ids: Vec<&str> = runs.iter().map(|r| r.job_id.as_str()).collect();
    assert_eq!(ids, vec!["scan-4", "scan-3"]);
}

#[tokio::test]
async fn list_job_runs_is_empty_when_nothing_has_run() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    assert!(c.list_job_runs(10).await.unwrap().is_empty());
}

#[tokio::test]
async fn every_status_round_trips() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();

    for status in ["done", "cancelled", "failed"] {
        c.record_job_run(run(
            &format!("scan-{status}"),
            "scan",
            Some(1),
            status,
            "2026-01-01T10:00:00",
            "2026-01-01T10:05:00",
        ))
        .await
        .unwrap();
    }

    let runs = c.list_job_runs(10).await.unwrap();
    let statuses: Vec<&str> = runs.iter().map(|r| r.status.as_str()).collect();
    assert_eq!(statuses, vec!["failed", "cancelled", "done"]);
}
