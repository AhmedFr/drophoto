use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, MediaKind, NewDrive, NewMedia, OrganizePlanItem, PlanStatus};
use dp_hash::Blake3Hasher;
use dp_jobs::{Job, JobCtx, JobEvent, JobRunner, OrganizeDeps, OrganizeJob};
use dp_organize::default_strategy;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

fn taken_at() -> DateTime<Utc> {
    "2025-09-12T10:00:00Z".parse().unwrap()
}

fn nm(drive_id: i64, rel_path: &str, hash: &str) -> NewMedia {
    NewMedia {
        drive_id,
        rel_path: rel_path.into(),
        hash: hash.into(),
        size: 1000,
        kind: MediaKind::Photo,
        ext: "jpg".into(),
        width: None,
        height: None,
        duration_ms: None,
        taken_at: Some(taken_at()),
        camera: None,
        lens: None,
        aperture: None,
        shutter: None,
        iso: None,
        focal_mm: None,
        lat: None,
        lon: None,
        organized_at: None,
    }
}

fn planned(media_id: i64, old: &str, new: &str) -> OrganizePlanItem {
    OrganizePlanItem {
        media_id,
        old_rel_path: old.into(),
        new_rel_path: new.into(),
        status: PlanStatus::Planned,
        reason: None,
    }
}

fn deps(catalog: Arc<dyn Catalog>) -> OrganizeDeps {
    OrganizeDeps {
        catalog,
        strategy: default_strategy(Arc::new(Blake3Hasher)),
    }
}

/// Drains `rx` until (and including) the terminal `Finished`/`Cancelled`
/// event, returning every event seen plus the terminal one. Mirrors the
/// equivalent helper in `tests/scan.rs`.
async fn drain_until_terminal(rx: &mut mpsc::Receiver<JobEvent>) -> (Vec<JobEvent>, JobEvent) {
    tokio::time::timeout(Duration::from_secs(60), async {
        let mut events = Vec::new();
        loop {
            let ev = rx
                .recv()
                .await
                .expect("channel closed before a terminal event arrived");
            let is_terminal = matches!(ev, JobEvent::Finished { .. } | JobEvent::Cancelled { .. });
            events.push(ev.clone());
            if is_terminal {
                return (events, ev);
            }
        }
    })
    .await
    .expect("timed out waiting for the job to reach a terminal state")
}

async fn register_drive(catalog: &Arc<dyn Catalog>, mount_path: &Path) -> dp_core::Drive {
    catalog
        .register_drive(NewDrive {
            name: "Organize Drive".into(),
            mount_path: mount_path.to_string_lossy().into_owned(),
            role: DriveRole::Source,
            capacity: 1_000_000,
            free: 500_000,
        })
        .await
        .unwrap()
}

#[tokio::test]
async fn moves_planned_items_skips_dup_and_reports_finished() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();
    std::fs::write(drive_dir.path().join("b.jpg"), b"content-b").unwrap();
    // Same bytes as a.jpg, but the job doesn't need to know that — it's
    // simply an item the (already-computed) plan marked SkippedDup.
    std::fs::write(drive_dir.path().join("dup.jpg"), b"content-a").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;

    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();
    let b_id = catalog.upsert_media(nm(drive.id, "b.jpg", "h-b")).await.unwrap();
    let dup_id = catalog
        .upsert_media(nm(drive.id, "dup.jpg", "h-a"))
        .await
        .unwrap();

    let items = vec![
        planned(a_id, "a.jpg", "archive/2025/Q3/2025-09-12_a.jpg"),
        planned(b_id, "b.jpg", "archive/2025/Q3/2025-09-12_b.jpg"),
        OrganizePlanItem {
            media_id: dup_id,
            old_rel_path: "dup.jpg".into(),
            new_rel_path: "dup.jpg".into(),
            status: PlanStatus::SkippedDup,
            reason: Some("duplicate of hash h-a".into()),
        },
    ];

    let job_row_id = catalog
        .create_organize_job(drive.id, items.len() as u64)
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("organize");
    let job = Arc::new(OrganizeJob::new(
        job_id.clone(),
        drive,
        job_row_id,
        items,
        deps(catalog.clone()),
    ));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 2, "events: {events:?}");
    assert_eq!(failed, 0, "events: {events:?}");
    assert_eq!(skipped, 1, "events: {events:?}");

    // Files landed at their new locations, and the originals are gone.
    assert_eq!(
        std::fs::read(drive_dir.path().join("archive/2025/Q3/2025-09-12_a.jpg")).unwrap(),
        b"content-a"
    );
    assert_eq!(
        std::fs::read(drive_dir.path().join("archive/2025/Q3/2025-09-12_b.jpg")).unwrap(),
        b"content-b"
    );
    assert!(!drive_dir.path().join("a.jpg").exists());
    assert!(!drive_dir.path().join("b.jpg").exists());

    // The skipped duplicate's file was never touched.
    assert!(drive_dir.path().join("dup.jpg").exists());
    assert_eq!(
        std::fs::read(drive_dir.path().join("dup.jpg")).unwrap(),
        b"content-a"
    );

    // Catalog reflects the moves.
    let (a_row, _) = catalog.get_media_with_drive(a_id).await.unwrap();
    assert_eq!(a_row.rel_path, "archive/2025/Q3/2025-09-12_a.jpg");
    assert!(a_row.organized_at.is_some());

    let (b_row, _) = catalog.get_media_with_drive(b_id).await.unwrap();
    assert_eq!(b_row.rel_path, "archive/2025/Q3/2025-09-12_b.jpg");
    assert!(b_row.organized_at.is_some());

    // The dup row's own path/organized_at are untouched by the job — only
    // the organize_items table records its skip.
    let (dup_row, _) = catalog.get_media_with_drive(dup_id).await.unwrap();
    assert_eq!(dup_row.rel_path, "dup.jpg");
    assert!(dup_row.organized_at.is_none());

    let job_row = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == job_row_id)
        .unwrap();
    assert_eq!(job_row.status, "done");
    assert_eq!(job_row.moved, 2);
    assert_eq!(job_row.skipped, 1);
    assert_eq!(job_row.failed, 0);
    assert!(job_row.finished_at.is_some());

    let item_rows = catalog.list_organize_items(job_row_id, 10).await.unwrap();
    assert_eq!(item_rows.len(), 3);
    let dup_item = item_rows.iter().find(|i| i.media_id == dup_id).unwrap();
    assert_eq!(dup_item.status, PlanStatus::SkippedDup);
}

#[tokio::test]
async fn cancelling_before_start_moves_nothing() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();

    let items = vec![planned(a_id, "a.jpg", "archive/2025/Q3/2025-09-12_a.jpg")];
    let job_row_id = catalog
        .create_organize_job(drive.id, items.len() as u64)
        .await
        .unwrap();

    let job = OrganizeJob::new(
        "organize-precancel".into(),
        drive,
        job_row_id,
        items,
        deps(catalog.clone()),
    );

    let cancel = CancellationToken::new();
    cancel.cancel();
    let (tx, _rx) = mpsc::channel(64);
    let ctx = JobCtx { events: tx, cancel };

    let outcome = job.run(ctx).await.unwrap();

    assert!(outcome.cancelled, "expected cancelled=true, got {outcome:?}");
    assert_eq!(outcome.ok + outcome.failed + outcome.skipped, 0);
    assert!(
        drive_dir.path().join("a.jpg").exists(),
        "no file should have been moved"
    );
    assert!(!drive_dir.path().join("archive/2025/Q3/2025-09-12_a.jpg").exists());

    let job_row = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == job_row_id)
        .unwrap();
    assert_eq!(job_row.status, "cancelled");
}

#[tokio::test]
async fn cancelling_via_runner_emits_cancelled() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();

    let items = vec![planned(a_id, "a.jpg", "archive/2025/Q3/2025-09-12_a.jpg")];
    let job_row_id = catalog
        .create_organize_job(drive.id, items.len() as u64)
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("organize");
    let job = Arc::new(OrganizeJob::new(
        job_id.clone(),
        drive,
        job_row_id,
        items,
        deps(catalog.clone()),
    ));
    runner.spawn(job_id.clone(), job);
    runner.cancel(&job_id);

    let (_events, terminal) = drain_until_terminal(&mut rx).await;
    assert!(
        matches!(terminal, JobEvent::Cancelled { .. }),
        "expected Cancelled, got {terminal:?}"
    );
}

#[tokio::test]
async fn missing_source_file_is_reported_failed_and_job_continues() {
    let drive_dir = tempfile::tempdir().unwrap();
    // Only b.jpg actually exists; a.jpg's row is planned but its file is
    // missing on disk.
    std::fs::write(drive_dir.path().join("b.jpg"), b"content-b").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();
    let b_id = catalog.upsert_media(nm(drive.id, "b.jpg", "h-b")).await.unwrap();

    let items = vec![
        planned(a_id, "a.jpg", "archive/2025/Q3/2025-09-12_a.jpg"),
        planned(b_id, "b.jpg", "archive/2025/Q3/2025-09-12_b.jpg"),
    ];
    let job_row_id = catalog
        .create_organize_job(drive.id, items.len() as u64)
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("organize");
    let job = Arc::new(OrganizeJob::new(
        job_id.clone(),
        drive,
        job_row_id,
        items,
        deps(catalog.clone()),
    ));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 1, "the second, valid item should still be moved: {events:?}");
    assert_eq!(failed, 1, "events: {events:?}");
    assert_eq!(skipped, 0, "events: {events:?}");

    let saw_item_error = events
        .iter()
        .any(|e| matches!(e, JobEvent::ItemError { path, .. } if path == "a.jpg"));
    assert!(saw_item_error, "expected an ItemError for a.jpg, got {events:?}");

    // b.jpg still moved successfully despite a.jpg's failure.
    assert_eq!(
        std::fs::read(drive_dir.path().join("archive/2025/Q3/2025-09-12_b.jpg")).unwrap(),
        b"content-b"
    );

    let (a_row, _) = catalog.get_media_with_drive(a_id).await.unwrap();
    assert_eq!(
        a_row.rel_path, "a.jpg",
        "a failed move must not touch the catalog row's path"
    );
    assert!(a_row.organized_at.is_none());

    let item_rows = catalog.list_organize_items(job_row_id, 10).await.unwrap();
    let a_item = item_rows.iter().find(|i| i.media_id == a_id).unwrap();
    assert_eq!(a_item.status, PlanStatus::Failed);
    assert!(a_item.error.is_some());
}
