use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{
    DpError, DpResult, Drive, DriveRole, MediaKind, MediaQuery, MediaRow, NewDrive, NewMedia,
    OrganizeItemRow, OrganizeJobRow, OrganizePlanItem, OrganizeRule, PlanStatus, UnorganizedSummary,
};
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
        mtime: None,
        source_id: None,
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
        home: None,
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
            volume_uuid: None,
            volume_label: None,
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
    let ctx = JobCtx::new(tx, cancel);

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
    match terminal {
        JobEvent::Cancelled {
            ok, failed, skipped, ..
        } => {
            assert_eq!(
                (ok, failed, skipped),
                (0, 0, 0),
                "no item was processed before the cancel landed, so the tallies should be zero"
            );
        }
        other => panic!("expected Cancelled, got {other:?}"),
    }
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

#[tokio::test]
async fn offline_drive_fails_the_job_and_finishes_the_job_row_as_failed() {
    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let mut drive = register_drive(&catalog, Path::new("/Volumes/Offline")).await;
    // Simulate the drive being offline: no mount path.
    drive.mount_path = None;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();

    let items = vec![planned(a_id, "a.jpg", "archive/2025/Q3/2025-09-12_a.jpg")];
    let job_row_id = catalog
        .create_organize_job(drive.id, items.len() as u64)
        .await
        .unwrap();

    let job = OrganizeJob::new(
        "organize-offline".into(),
        drive,
        job_row_id,
        items,
        deps(catalog.clone()),
    );

    let (tx, _rx) = mpsc::channel(64);
    let ctx = JobCtx::new(tx, CancellationToken::new());

    let err = job.run(ctx).await.unwrap_err();
    assert!(
        matches!(err, dp_core::DpError::NotFound { .. }),
        "expected NotFound, got {err:?}"
    );

    let job_row = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == job_row_id)
        .unwrap();
    assert_eq!(job_row.status, "failed");
}

#[tokio::test]
async fn a_new_rel_path_escaping_the_mount_is_failed_and_never_touched() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();

    // A hand-crafted, maliciously (or buggily) planned item whose
    // new_rel_path attempts to climb out of the drive's mount point.
    let items = vec![planned(a_id, "a.jpg", "../escape.jpg")];
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
    let (ok, failed) = match terminal {
        JobEvent::Finished { ok, failed, .. } => (ok, failed),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 0, "events: {events:?}");
    assert_eq!(failed, 1, "events: {events:?}");

    let saw_path_error = events
        .iter()
        .any(|e| matches!(e, JobEvent::ItemError { code, .. } if code == "path"));
    assert!(
        saw_path_error,
        "expected an ItemError with code \"path\", got {events:?}"
    );

    // The original file must still be exactly where it was, and nothing
    // must have been written outside the drive's mount point.
    assert_eq!(
        std::fs::read(drive_dir.path().join("a.jpg")).unwrap(),
        b"content-a"
    );
    assert!(
        !drive_dir.path().parent().unwrap().join("escape.jpg").exists(),
        "the escaped destination must never be created"
    );

    let (a_row, _) = catalog.get_media_with_drive(a_id).await.unwrap();
    assert_eq!(a_row.rel_path, "a.jpg");
    assert!(a_row.organized_at.is_none());

    let item_rows = catalog.list_organize_items(job_row_id, 10).await.unwrap();
    assert_eq!(item_rows[0].status, PlanStatus::Failed);
}

/// CRITICAL regression test: `escapes_mount` is purely lexical, so a
/// plain relative `new_rel_path` like `archive/2025/…` sails straight
/// past it — even when `<mount>/archive` is a *directory symlink*
/// pointing somewhere else entirely. Without a physical resolution
/// check the job would happily move the user's photos off the drive and
/// into whatever that symlink targets.
#[tokio::test]
async fn a_destination_behind_a_directory_symlink_is_failed_and_never_written() {
    let drive_dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();

    // `<mount>/archive` → a directory completely outside the drive.
    std::os::unix::fs::symlink(outside.path(), drive_dir.path().join("archive")).unwrap();

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
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let (ok, failed) = match terminal {
        JobEvent::Finished { ok, failed, .. } => (ok, failed),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 0, "events: {events:?}");
    assert_eq!(failed, 1, "events: {events:?}");

    let saw_path_error = events.iter().any(
        |e| matches!(e, JobEvent::ItemError { code, message, .. } if code == "path" && message == "destination resolves outside the drive"),
    );
    assert!(saw_path_error, "expected a \"path\" ItemError, got {events:?}");

    // The source is untouched, and nothing at all was created outside.
    assert_eq!(
        std::fs::read(drive_dir.path().join("a.jpg")).unwrap(),
        b"content-a"
    );
    let outside_entries: Vec<_> = std::fs::read_dir(outside.path()).unwrap().collect();
    assert!(
        outside_entries.is_empty(),
        "nothing may be written outside the drive"
    );

    let (a_row, _) = catalog.get_media_with_drive(a_id).await.unwrap();
    assert_eq!(a_row.rel_path, "a.jpg");
    assert!(a_row.organized_at.is_none());

    let item_rows = catalog.list_organize_items(job_row_id, 10).await.unwrap();
    assert_eq!(item_rows[0].status, PlanStatus::Failed);
}

/// `old_rel_path` gets the same lexical treatment as `new_rel_path`: a
/// plan whose *source* climbs out of the mount must never have the job
/// read (let alone move) a file from outside the drive.
#[tokio::test]
async fn an_old_rel_path_escaping_the_mount_is_failed_and_never_touched() {
    let drive_dir = tempfile::tempdir().unwrap();
    let outside_file = drive_dir.path().parent().unwrap().join("dp-outside-source.jpg");
    std::fs::write(&outside_file, b"not yours").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();

    let outside_rel = format!("../{}", outside_file.file_name().unwrap().to_string_lossy());
    let items = vec![planned(a_id, &outside_rel, "archive/2025/Q3/2025-09-12_a.jpg")];
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
    let failed = match terminal {
        JobEvent::Finished { failed, .. } => failed,
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(failed, 1, "events: {events:?}");
    assert_eq!(
        std::fs::read(&outside_file).unwrap(),
        b"not yours",
        "a file outside the drive must never be read or moved"
    );
    std::fs::remove_file(&outside_file).unwrap();
}

/// A [`MoveStrategy`] that applies the first move for real and panics on
/// every one after it — so the job's panic path can be observed with a
/// non-zero tally already on the books.
struct PanicAfterFirstStrategy {
    inner: Arc<dyn dp_organize::MoveStrategy>,
    seen: AtomicU64,
}

#[async_trait::async_trait]
impl dp_organize::MoveStrategy for PanicAfterFirstStrategy {
    async fn move_file(&self, from: &Path, to: &Path) -> DpResult<()> {
        if self.seen.fetch_add(1, Ordering::SeqCst) == 0 {
            return self.inner.move_file(from, to).await;
        }
        panic!("boom");
    }
}

/// A panic partway through used to close the `organize_jobs` row out as
/// `0/0/0`, silently disowning every photo that had already been moved.
/// The row must report what actually happened.
#[tokio::test]
async fn a_panic_partway_through_still_reports_the_items_already_applied() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();
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

    let job_deps = OrganizeDeps {
        catalog: catalog.clone(),
        strategy: Arc::new(PanicAfterFirstStrategy {
            inner: default_strategy(Arc::new(Blake3Hasher)),
            seen: AtomicU64::new(0),
        }),
        home: None,
    };
    let job = OrganizeJob::new("organize-panic".into(), drive, job_row_id, items, job_deps);

    let (tx, _rx) = mpsc::channel(64);
    let ctx = JobCtx::new(tx, CancellationToken::new());

    let err = job.run(ctx).await.unwrap_err();
    assert!(matches!(err, DpError::Io { .. }), "expected Io, got {err:?}");

    let job_row = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == job_row_id)
        .unwrap();
    assert_eq!(job_row.status, "failed");
    assert_eq!(job_row.moved, 1, "the first item really was moved");
    assert!(job_row.finished_at.is_some());

    // And that first move genuinely landed on disk.
    assert_eq!(
        std::fs::read(drive_dir.path().join("archive/2025/Q3/2025-09-12_a.jpg")).unwrap(),
        b"content-a"
    );
}

/// A [`Catalog`] wrapper that delegates every call to `inner` except
/// `mark_media_organized`, which always fails — used to exercise the
/// job's handling of a move that succeeds on disk but can't be recorded
/// in the catalog afterwards.
struct FailingCatalog(Arc<dyn Catalog>);

#[async_trait::async_trait]
impl Catalog for FailingCatalog {
    async fn register_drive(&self, d: dp_core::NewDrive) -> DpResult<Drive> {
        self.0.register_drive(d).await
    }

    async fn list_drives(&self) -> DpResult<Vec<Drive>> {
        self.0.list_drives().await
    }

    async fn set_drive_presence(&self, id: i64, mount_path: Option<&str>, free: Option<u64>) -> DpResult<()> {
        self.0.set_drive_presence(id, mount_path, free).await
    }

    async fn backfill_drive_volume_identity(
        &self,
        id: i64,
        volume_uuid: Option<&str>,
        volume_label: Option<&str>,
    ) -> DpResult<()> {
        self.0
            .backfill_drive_volume_identity(id, volume_uuid, volume_label)
            .await
    }

    async fn relink_drive(
        &self,
        id: i64,
        volume_uuid: Option<&str>,
        volume_label: Option<&str>,
        mount_path: &str,
        free: Option<u64>,
    ) -> DpResult<()> {
        self.0
            .relink_drive(id, volume_uuid, volume_label, mount_path, free)
            .await
    }

    async fn forget_drive(&self, id: i64) -> DpResult<()> {
        self.0.forget_drive(id).await
    }

    async fn upsert_media(&self, m: NewMedia) -> DpResult<i64> {
        self.0.upsert_media(m).await
    }

    async fn list_media(&self, limit: u32, offset: u32) -> DpResult<Vec<MediaRow>> {
        self.0.list_media(limit, offset).await
    }

    async fn query_media(&self, q: &MediaQuery) -> DpResult<Vec<(MediaRow, Drive)>> {
        self.0.query_media(q).await
    }

    async fn count_media_query(&self, q: &MediaQuery) -> DpResult<u64> {
        self.0.count_media_query(q).await
    }

    async fn get_media_with_drive(&self, id: i64) -> DpResult<(MediaRow, Drive)> {
        self.0.get_media_with_drive(id).await
    }

    async fn count_media(&self, drive_id: Option<i64>) -> DpResult<u64> {
        self.0.count_media(drive_id).await
    }

    async fn media_hash_exists(&self, hash: &str) -> DpResult<bool> {
        self.0.media_hash_exists(hash).await
    }

    async fn list_media_without_source(&self, drive_id: i64) -> DpResult<Vec<dp_core::MediaRow>> {
        self.0.list_media_without_source(drive_id).await
    }

    async fn list_scan_index(&self, drive_id: i64) -> DpResult<Vec<dp_core::ScanIndexEntry>> {
        self.0.list_scan_index(drive_id).await
    }

    async fn set_sidecar_mtime(&self, media_id: i64, mtime: DateTime<Utc>) -> DpResult<()> {
        self.0.set_sidecar_mtime(media_id, mtime).await
    }

    async fn delete_media(&self, id: i64) -> DpResult<bool> {
        self.0.delete_media(id).await
    }

    async fn update_media_metadata(
        &self,
        id: i64,
        m: &dp_core::MediaMetadata,
        read_at: DateTime<Utc>,
    ) -> DpResult<()> {
        self.0.update_media_metadata(id, m, read_at).await
    }

    async fn record_scan_error(&self, drive_id: i64, path: &str, code: &str, message: &str) -> DpResult<()> {
        self.0.record_scan_error(drive_id, path, code, message).await
    }

    async fn count_scan_errors(&self, drive_id: i64) -> DpResult<u64> {
        self.0.count_scan_errors(drive_id).await
    }

    async fn list_scan_errors(
        &self,
        drive_id: i64,
        limit: u32,
        offset: u32,
    ) -> DpResult<Vec<dp_core::ScanErrorRow>> {
        self.0.list_scan_errors(drive_id, limit, offset).await
    }

    async fn get_rule(&self, drive_id: i64) -> DpResult<OrganizeRule> {
        self.0.get_rule(drive_id).await
    }

    async fn save_rule(&self, r: &OrganizeRule) -> DpResult<()> {
        self.0.save_rule(r).await
    }

    async fn list_unorganized(&self, drive_id: i64, root: &str) -> DpResult<Vec<MediaRow>> {
        self.0.list_unorganized(drive_id, root).await
    }

    async fn unorganized_summary(&self, drive_id: i64, root: &str) -> DpResult<UnorganizedSummary> {
        self.0.unorganized_summary(drive_id, root).await
    }

    async fn organized_hashes(&self, hashes: &[String]) -> DpResult<HashSet<String>> {
        self.0.organized_hashes(hashes).await
    }

    async fn list_rel_paths(&self, drive_id: i64) -> DpResult<Vec<String>> {
        self.0.list_rel_paths(drive_id).await
    }

    async fn create_organize_job(&self, drive_id: i64, planned: u64) -> DpResult<i64> {
        self.0.create_organize_job(drive_id, planned).await
    }

    async fn create_revert_job(&self, drive_id: i64, reverts_job_id: i64, planned: u64) -> DpResult<i64> {
        self.0.create_revert_job(drive_id, reverts_job_id, planned).await
    }

    async fn finish_organize_job(
        &self,
        id: i64,
        status: &str,
        moved: u64,
        skipped: u64,
        failed: u64,
    ) -> DpResult<()> {
        self.0
            .finish_organize_job(id, status, moved, skipped, failed)
            .await
    }

    async fn insert_organize_item(&self, item: &OrganizeItemRow) -> DpResult<i64> {
        self.0.insert_organize_item(item).await
    }

    async fn mark_media_organized(&self, _media_id: i64, _new_rel_path: &str) -> DpResult<()> {
        Err(DpError::Db {
            message: "simulated catalog failure".into(),
        })
    }

    async fn mark_media_reverted(&self, media_id: i64, old_rel_path: &str) -> DpResult<()> {
        self.0.mark_media_reverted(media_id, old_rel_path).await
    }

    async fn list_organize_jobs(&self, limit: u32) -> DpResult<Vec<OrganizeJobRow>> {
        self.0.list_organize_jobs(limit).await
    }

    async fn get_organize_job(&self, id: i64) -> DpResult<Option<OrganizeJobRow>> {
        self.0.get_organize_job(id).await
    }

    async fn list_organize_items(&self, job_id: i64, limit: u32) -> DpResult<Vec<OrganizeItemRow>> {
        self.0.list_organize_items(job_id, limit).await
    }

    async fn list_sources(&self, drive_id: i64) -> DpResult<Vec<dp_core::Source>> {
        self.0.list_sources(drive_id).await
    }

    async fn upsert_source(&self, s: dp_core::NewSource) -> DpResult<dp_core::Source> {
        self.0.upsert_source(s).await
    }

    async fn set_source_enabled(&self, id: i64, enabled: bool) -> DpResult<()> {
        self.0.set_source_enabled(id, enabled).await
    }

    async fn delete_source(&self, id: i64) -> DpResult<()> {
        self.0.delete_source(id).await
    }

    async fn list_enabled_sources(&self, drive_id: i64) -> DpResult<Vec<dp_core::Source>> {
        self.0.list_enabled_sources(drive_id).await
    }

    async fn count_legacy_unorganized(&self, drive_id: i64, root: &str) -> DpResult<u64> {
        self.0.count_legacy_unorganized(drive_id, root).await
    }

    async fn list_tags(&self) -> DpResult<Vec<dp_core::Tag>> {
        self.0.list_tags().await
    }

    async fn tags_for_media(&self, ids: &[i64]) -> DpResult<Vec<(i64, dp_core::Tag)>> {
        self.0.tags_for_media(ids).await
    }

    async fn tag_media(&self, ids: &[i64], add: &[String], remove: &[i64]) -> DpResult<()> {
        self.0.tag_media(ids, add, remove).await
    }

    async fn tag_names_for_media(&self, media_id: i64) -> DpResult<Vec<String>> {
        self.0.tag_names_for_media(media_id).await
    }

    async fn list_sidecar_pending(&self, drive_id: i64) -> DpResult<Vec<MediaRow>> {
        self.0.list_sidecar_pending(drive_id).await
    }

    async fn has_sidecar_pending(&self, drive_id: i64) -> DpResult<bool> {
        self.0.has_sidecar_pending(drive_id).await
    }

    async fn clear_sidecar_pending(&self, media_id: i64) -> DpResult<()> {
        self.0.clear_sidecar_pending(media_id).await
    }

    async fn mark_sidecar_pending(&self, media_id: i64) -> DpResult<()> {
        self.0.mark_sidecar_pending(media_id).await
    }

    async fn sync_fts(&self, media_id: i64) -> DpResult<()> {
        self.0.sync_fts(media_id).await
    }

    async fn rebuild_fts(&self) -> DpResult<()> {
        self.0.rebuild_fts().await
    }

    async fn search_media(&self, query: &str, limit: u32) -> DpResult<Vec<(MediaRow, Drive)>> {
        self.0.search_media(query, limit).await
    }

    async fn upsert_place(&self, p: dp_core::NewPlace) -> DpResult<dp_core::Place> {
        self.0.upsert_place(p).await
    }

    async fn list_place_counts(&self) -> DpResult<Vec<dp_core::PlaceCount>> {
        self.0.list_place_counts().await
    }

    async fn set_media_place(&self, ids: &[i64], place_id: Option<i64>) -> DpResult<()> {
        self.0.set_media_place(ids, place_id).await
    }

    async fn list_ungeocoded(&self, after_id: i64, limit: u32) -> DpResult<Vec<MediaRow>> {
        self.0.list_ungeocoded(after_id, limit).await
    }

    async fn record_job_run(&self, run: dp_core::NewJobRun) -> DpResult<()> {
        self.0.record_job_run(run).await
    }

    async fn list_job_runs(&self, limit: u32) -> DpResult<Vec<dp_core::JobRunRow>> {
        self.0.list_job_runs(limit).await
    }

    async fn get_settings(&self) -> DpResult<dp_core::AppSettings> {
        self.0.get_settings().await
    }

    async fn set_preview_edge(&self, edge: u32) -> DpResult<()> {
        self.0.set_preview_edge(edge).await
    }
}

#[tokio::test]
async fn a_catalog_failure_after_a_successful_move_is_recorded_failed_not_moved() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();

    let real_catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&real_catalog, drive_dir.path()).await;
    let a_id = real_catalog
        .upsert_media(nm(drive.id, "a.jpg", "h-a"))
        .await
        .unwrap();

    let items = vec![planned(a_id, "a.jpg", "archive/2025/Q3/2025-09-12_a.jpg")];
    let job_row_id = real_catalog
        .create_organize_job(drive.id, items.len() as u64)
        .await
        .unwrap();

    let failing_catalog: Arc<dyn Catalog> = Arc::new(FailingCatalog(real_catalog.clone()));
    let job_deps = OrganizeDeps {
        catalog: failing_catalog,
        strategy: default_strategy(Arc::new(Blake3Hasher)),
        home: None,
    };

    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("organize");
    let job = Arc::new(OrganizeJob::new(
        job_id.clone(),
        drive,
        job_row_id,
        items,
        job_deps,
    ));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let (ok, failed) = match terminal {
        JobEvent::Finished { ok, failed, .. } => (ok, failed),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 0, "a catalog failure must not count as ok: {events:?}");
    assert_eq!(failed, 1, "events: {events:?}");

    // The file itself was actually moved — `move_file` succeeded, only
    // the catalog update afterwards failed.
    assert!(!drive_dir.path().join("a.jpg").exists());
    assert_eq!(
        std::fs::read(drive_dir.path().join("archive/2025/Q3/2025-09-12_a.jpg")).unwrap(),
        b"content-a"
    );

    // The real catalog (queried directly, bypassing the failing wrapper)
    // was never updated: the row's path/organized_at are unchanged.
    let (a_row, _) = real_catalog.get_media_with_drive(a_id).await.unwrap();
    assert_eq!(a_row.rel_path, "a.jpg");
    assert!(a_row.organized_at.is_none());

    let item_rows = real_catalog.list_organize_items(job_row_id, 10).await.unwrap();
    assert_eq!(item_rows[0].status, PlanStatus::Failed);
    assert!(
        item_rows[0]
            .error
            .as_deref()
            .unwrap()
            .starts_with("moved but catalog update failed"),
        "unexpected error message: {:?}",
        item_rows[0].error
    );
}

/// Safety-net guard: a plan can only ever have been produced by
/// `dp_organize::plan` if the rule/root were themselves valid, but a
/// row's *source* path is never re-validated against the deny-list once
/// scanned — a package directory (`Foo.app`) planted or discovered after
/// the fact must still stop the job cold rather than move something out
/// of it.
#[tokio::test]
async fn a_source_under_a_denied_package_directory_is_failed_and_never_touched() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(drive_dir.path().join("Foo.app/Contents")).unwrap();
    std::fs::write(drive_dir.path().join("Foo.app/Contents/x.jpg"), b"app-bundled").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let x_id = catalog
        .upsert_media(nm(drive.id, "Foo.app/Contents/x.jpg", "h-x"))
        .await
        .unwrap();

    let items = vec![planned(
        x_id,
        "Foo.app/Contents/x.jpg",
        "archive/2025/Q3/2025-09-12_x.jpg",
    )];
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
    let (ok, failed) = match terminal {
        JobEvent::Finished { ok, failed, .. } => (ok, failed),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 0, "events: {events:?}");
    assert_eq!(failed, 1, "events: {events:?}");

    let saw_denied_error = events.iter().any(
        |e| matches!(e, JobEvent::ItemError { code, message, .. } if code == "denied" && message == "path is on the safety deny-list"),
    );
    assert!(
        saw_denied_error,
        "expected a \"denied\" ItemError, got {events:?}"
    );

    // The bundled file must never have been touched, and nothing must
    // have been created at the planned destination.
    assert_eq!(
        std::fs::read(drive_dir.path().join("Foo.app/Contents/x.jpg")).unwrap(),
        b"app-bundled"
    );
    assert!(!drive_dir.path().join("archive/2025/Q3/2025-09-12_x.jpg").exists());

    let (x_row, _) = catalog.get_media_with_drive(x_id).await.unwrap();
    assert_eq!(x_row.rel_path, "Foo.app/Contents/x.jpg");
    assert!(x_row.organized_at.is_none());

    let item_rows = catalog.list_organize_items(job_row_id, 10).await.unwrap();
    assert_eq!(item_rows[0].status, PlanStatus::Failed);
}

/// The same guard applies to the *destination* side: a rule/template
/// combination that would land a file under a denied name (here, a
/// literal root of `Caches`) must be refused by the job even though
/// nothing about the move is otherwise unsafe.
#[tokio::test]
async fn a_destination_under_a_denied_name_is_failed_and_never_written() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();

    let items = vec![planned(a_id, "a.jpg", "Caches/2025/Q3/2025-09-12_a.jpg")];
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
    let (ok, failed) = match terminal {
        JobEvent::Finished { ok, failed, .. } => (ok, failed),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 0, "events: {events:?}");
    assert_eq!(failed, 1, "events: {events:?}");

    let saw_denied_error = events.iter().any(
        |e| matches!(e, JobEvent::ItemError { code, message, .. } if code == "denied" && message == "path is on the safety deny-list"),
    );
    assert!(
        saw_denied_error,
        "expected a \"denied\" ItemError, got {events:?}"
    );

    assert_eq!(
        std::fs::read(drive_dir.path().join("a.jpg")).unwrap(),
        b"content-a"
    );
    assert!(!drive_dir.path().join("Caches/2025/Q3/2025-09-12_a.jpg").exists());

    let (a_row, _) = catalog.get_media_with_drive(a_id).await.unwrap();
    assert_eq!(a_row.rel_path, "a.jpg");
    assert!(a_row.organized_at.is_none());
}

/// A media move's `.xmp` sidecar must travel with it: created next to
/// `a.jpg` before the job runs, it must end up next to the moved file
/// under `archive/...`, with nothing left behind at either original
/// location.
#[tokio::test]
async fn organize_moves_the_sidecar_with_the_file() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();
    std::fs::write(drive_dir.path().join("a.jpg.xmp"), b"<xmp/>").unwrap();

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
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let (ok, failed) = match terminal {
        JobEvent::Finished { ok, failed, .. } => (ok, failed),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 1, "events: {events:?}");
    assert_eq!(failed, 0, "events: {events:?}");
    assert!(
        events.iter().all(|e| !matches!(e, JobEvent::ItemError { .. })),
        "unexpected ItemError: {events:?}"
    );

    assert_eq!(
        std::fs::read(drive_dir.path().join("archive/2025/Q3/2025-09-12_a.jpg")).unwrap(),
        b"content-a"
    );
    assert_eq!(
        std::fs::read(drive_dir.path().join("archive/2025/Q3/2025-09-12_a.jpg.xmp")).unwrap(),
        b"<xmp/>"
    );
    assert!(!drive_dir.path().join("a.jpg").exists());
    assert!(!drive_dir.path().join("a.jpg.xmp").exists());

    let (a_row, _) = catalog.get_media_with_drive(a_id).await.unwrap();
    assert!(!a_row.sidecar_pending);
}

/// A media item with no `.xmp` sidecar must produce no sidecar-related
/// events or catalog side effects at all — `move_sidecar_along` is a
/// no-op the moment `symlink_metadata(sc_from)` fails.
#[tokio::test]
async fn organize_without_a_sidecar_emits_no_sidecar_events() {
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
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let (ok, failed) = match terminal {
        JobEvent::Finished { ok, failed, .. } => (ok, failed),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 1, "events: {events:?}");
    assert_eq!(failed, 0, "events: {events:?}");
    assert!(
        events.iter().all(|e| !matches!(e, JobEvent::ItemError { .. })),
        "unexpected ItemError: {events:?}"
    );

    let (a_row, _) = catalog.get_media_with_drive(a_id).await.unwrap();
    assert!(!a_row.sidecar_pending);
}

/// If the sidecar's own move fails — here, because something else
/// already occupies its destination — the media item itself must still
/// read `Moved` (the media move already succeeded), the job's own
/// moved/failed tallies must be unaffected by the sidecar failure, and
/// the row must be left `sidecar_pending` so a later sync job recreates
/// the sidecar at the new path.
#[tokio::test]
async fn sidecar_move_failure_marks_pending_not_failed() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();
    std::fs::write(drive_dir.path().join("a.jpg.xmp"), b"<xmp/>").unwrap();

    // Pre-create a *directory* at the sidecar's destination path so the
    // sidecar's own move_file fails, while the destination directory for
    // the media file itself is left free.
    std::fs::create_dir_all(drive_dir.path().join("archive/2025/Q3/2025-09-12_a.jpg.xmp")).unwrap();

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
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let (ok, failed) = match terminal {
        JobEvent::Finished { ok, failed, .. } => (ok, failed),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    // The tallies reflect only the media move, unaffected by the
    // sidecar's own failure.
    assert_eq!(ok, 1, "events: {events:?}");
    assert_eq!(failed, 0, "events: {events:?}");

    let saw_sidecar_error = events
        .iter()
        .any(|e| matches!(e, JobEvent::ItemError { code, .. } if code == "sidecar"));
    assert!(
        saw_sidecar_error,
        "expected a \"sidecar\" ItemError, got {events:?}"
    );

    // The media file itself was moved.
    assert_eq!(
        std::fs::read(drive_dir.path().join("archive/2025/Q3/2025-09-12_a.jpg")).unwrap(),
        b"content-a"
    );
    assert!(!drive_dir.path().join("a.jpg").exists());

    // The sidecar was left behind, since the move failed.
    assert_eq!(
        std::fs::read(drive_dir.path().join("a.jpg.xmp")).unwrap(),
        b"<xmp/>"
    );

    let item_rows = catalog.list_organize_items(job_row_id, 10).await.unwrap();
    assert_eq!(item_rows.len(), 1);
    assert_eq!(item_rows[0].status, PlanStatus::Moved);

    let (a_row, _) = catalog.get_media_with_drive(a_id).await.unwrap();
    assert!(a_row.sidecar_pending);
}
