use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{
    Drive, DriveRole, MediaKind, NewDrive, NewMedia, OrganizeItemRow, OrganizePlanItem, PlanStatus,
};
use dp_hash::Blake3Hasher;
use dp_jobs::{Job, JobCtx, JobEvent, JobRunner, OrganizeDeps, OrganizeJob, RevertJob};
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

async fn register_drive(catalog: &Arc<dyn Catalog>, mount_path: &Path) -> Drive {
    catalog
        .register_drive(NewDrive {
            name: "Revert Drive".into(),
            mount_path: mount_path.to_string_lossy().into_owned(),
            role: DriveRole::Source,
            capacity: 1_000_000,
            free: 500_000,
        })
        .await
        .unwrap()
}

/// Runs an [`OrganizeJob`] over `items` to completion and returns the
/// resulting `organize_items` rows (in job order) — the shared setup
/// every revert test starts from: "an organize job that already ran".
async fn run_organize(
    catalog: &Arc<dyn Catalog>,
    drive: Drive,
    items: Vec<OrganizePlanItem>,
) -> (i64, Vec<OrganizeItemRow>) {
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

    let (_events, terminal) = drain_until_terminal(&mut rx).await;
    assert!(
        matches!(terminal, JobEvent::Finished { .. }),
        "organize setup must finish"
    );

    let item_rows = catalog.list_organize_items(job_row_id, 100).await.unwrap();
    (job_row_id, item_rows)
}

#[tokio::test]
async fn reverts_moved_items_back_to_their_original_locations() {
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
    let (organize_job_id, organize_items) = run_organize(&catalog, drive.clone(), items).await;

    // Sanity: the organize setup really did move both files.
    assert!(drive_dir.path().join("archive/2025/Q3/2025-09-12_a.jpg").exists());
    assert!(!drive_dir.path().join("a.jpg").exists());

    let revert_row_id = catalog
        .create_revert_job(drive.id, organize_job_id, 2)
        .await
        .unwrap();
    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("revert");
    let job = Arc::new(RevertJob::new(
        job_id.clone(),
        drive,
        revert_row_id,
        organize_items,
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
    assert_eq!(skipped, 0, "events: {events:?}");

    // Original paths are restored, and the organized locations are gone.
    assert_eq!(
        std::fs::read(drive_dir.path().join("a.jpg")).unwrap(),
        b"content-a"
    );
    assert_eq!(
        std::fs::read(drive_dir.path().join("b.jpg")).unwrap(),
        b"content-b"
    );
    assert!(!drive_dir.path().join("archive/2025/Q3/2025-09-12_a.jpg").exists());
    assert!(!drive_dir.path().join("archive/2025/Q3/2025-09-12_b.jpg").exists());

    // Catalog rows are back to their pre-organize state.
    let (a_row, _) = catalog.get_media_with_drive(a_id).await.unwrap();
    assert_eq!(a_row.rel_path, "a.jpg");
    assert!(a_row.organized_at.is_none());
    let (b_row, _) = catalog.get_media_with_drive(b_id).await.unwrap();
    assert_eq!(b_row.rel_path, "b.jpg");
    assert!(b_row.organized_at.is_none());

    let job_row = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == revert_row_id)
        .unwrap();
    assert_eq!(job_row.status, "done");
    assert_eq!(job_row.kind, "revert");
    assert_eq!(job_row.reverts_job_id, Some(organize_job_id));
    assert_eq!(job_row.moved, 2);
    assert_eq!(job_row.failed, 0);

    // The revert row shows up on the organize job it reverted.
    let organize_row = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == organize_job_id)
        .unwrap();
    assert_eq!(organize_row.reverted_by_job_id, Some(revert_row_id));

    // The revert job's own `organize_items` rows record old/new swapped.
    let revert_items = catalog.list_organize_items(revert_row_id, 10).await.unwrap();
    assert_eq!(revert_items.len(), 2);
    let a_item = revert_items.iter().find(|i| i.media_id == a_id).unwrap();
    assert_eq!(a_item.old_rel_path, "archive/2025/Q3/2025-09-12_a.jpg");
    assert_eq!(a_item.new_rel_path, "a.jpg");
    assert_eq!(a_item.status, PlanStatus::Moved);
}

#[tokio::test]
async fn reverts_items_in_reverse_of_the_original_order() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();
    std::fs::write(drive_dir.path().join("b.jpg"), b"content-b").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();
    let b_id = catalog.upsert_media(nm(drive.id, "b.jpg", "h-b")).await.unwrap();

    let items = vec![
        planned(a_id, "a.jpg", "archive/a.jpg"),
        planned(b_id, "b.jpg", "archive/b.jpg"),
    ];
    let (organize_job_id, organize_items) = run_organize(&catalog, drive.clone(), items).await;

    let revert_row_id = catalog
        .create_revert_job(drive.id, organize_job_id, 2)
        .await
        .unwrap();
    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("revert");
    let job = Arc::new(RevertJob::new(
        job_id.clone(),
        drive,
        revert_row_id,
        organize_items,
        deps(catalog.clone()),
    ));
    runner.spawn(job_id, job);

    let (events, _terminal) = drain_until_terminal(&mut rx).await;
    let first_progress_path = events.iter().find_map(|e| match e {
        JobEvent::Progress { current, .. } => current.clone(),
        _ => None,
    });
    // b.jpg was organized second, so it must be reverted first.
    assert_eq!(first_progress_path.as_deref(), Some("archive/b.jpg"));
}

#[tokio::test]
async fn a_second_revert_of_the_same_job_is_refused_by_the_catalog_state() {
    // The job itself doesn't refuse a second revert (that's the command
    // layer's job) — but nothing stops two revert rows from being
    // created for the same organize job at the catalog layer, and a
    // second run over already-restored items must simply fail per-item
    // (the "occupied destination" case below) rather than corrupt
    // anything. This test documents that a *second* RevertJob run over
    // the same, already-reverted items reports every item failed.
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();

    let items = vec![planned(a_id, "a.jpg", "archive/a.jpg")];
    let (organize_job_id, organize_items) = run_organize(&catalog, drive.clone(), items).await;

    // First revert: succeeds, restores a.jpg.
    let revert_row_id = catalog
        .create_revert_job(drive.id, organize_job_id, 1)
        .await
        .unwrap();
    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("revert");
    let job = Arc::new(RevertJob::new(
        job_id.clone(),
        drive.clone(),
        revert_row_id,
        organize_items,
        deps(catalog.clone()),
    ));
    runner.spawn(job_id, job);
    let (_events, terminal) = drain_until_terminal(&mut rx).await;
    assert!(matches!(terminal, JobEvent::Finished { ok: 1, failed: 0, .. }));

    // Second revert attempt over the *same* (now-stale) organize items:
    // `from` (archive/a.jpg) no longer exists — the job must fail the
    // item, not touch anything.
    let organize_items_again = catalog.list_organize_items(organize_job_id, 10).await.unwrap();
    let revert_row_id_2 = catalog
        .create_revert_job(drive.id, organize_job_id, 1)
        .await
        .unwrap();
    let (tx2, mut rx2) = mpsc::channel(64);
    let runner2 = JobRunner::new(tx2);
    let job_id2 = runner2.next_id("revert");
    let job2 = Arc::new(RevertJob::new(
        job_id2.clone(),
        drive,
        revert_row_id_2,
        organize_items_again,
        deps(catalog.clone()),
    ));
    runner2.spawn(job_id2, job2);
    let (events2, terminal2) = drain_until_terminal(&mut rx2).await;
    let failed = match terminal2 {
        JobEvent::Finished { failed, .. } => failed,
        other => panic!("expected Finished, got {other:?} (events: {events2:?})"),
    };
    assert_eq!(failed, 1, "events: {events2:?}");
    let saw_missing = events2
        .iter()
        .any(|e| matches!(e, JobEvent::ItemError { message, .. } if message == "source missing"));
    assert!(
        saw_missing,
        "expected a \"source missing\" ItemError, got {events2:?}"
    );

    assert_eq!(
        std::fs::read(drive_dir.path().join("a.jpg")).unwrap(),
        b"content-a"
    );
}

#[tokio::test]
async fn an_occupied_destination_is_failed_and_the_file_is_left_untouched() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();

    let items = vec![planned(a_id, "a.jpg", "archive/a.jpg")];
    let (organize_job_id, organize_items) = run_organize(&catalog, drive.clone(), items).await;

    // Something else now occupies the original path the revert would
    // restore to.
    std::fs::write(drive_dir.path().join("a.jpg"), b"someone else's file").unwrap();

    let revert_row_id = catalog
        .create_revert_job(drive.id, organize_job_id, 1)
        .await
        .unwrap();
    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("revert");
    let job = Arc::new(RevertJob::new(
        job_id.clone(),
        drive,
        revert_row_id,
        organize_items,
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

    // Neither file was touched: the occupying file survives, and the
    // organized copy is still exactly where it was.
    assert_eq!(
        std::fs::read(drive_dir.path().join("a.jpg")).unwrap(),
        b"someone else's file"
    );
    assert_eq!(
        std::fs::read(drive_dir.path().join("archive/a.jpg")).unwrap(),
        b"content-a"
    );

    let (a_row, _) = catalog.get_media_with_drive(a_id).await.unwrap();
    assert_eq!(
        a_row.rel_path, "archive/a.jpg",
        "a failed revert must not touch the catalog row"
    );
    assert!(a_row.organized_at.is_some());
}

#[tokio::test]
async fn a_missing_source_is_failed_and_the_job_continues() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();
    std::fs::write(drive_dir.path().join("b.jpg"), b"content-b").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();
    let b_id = catalog.upsert_media(nm(drive.id, "b.jpg", "h-b")).await.unwrap();

    let items = vec![
        planned(a_id, "a.jpg", "archive/a.jpg"),
        planned(b_id, "b.jpg", "archive/b.jpg"),
    ];
    let (organize_job_id, organize_items) = run_organize(&catalog, drive.clone(), items).await;

    // The organized copy of a.jpg gets removed out-of-band before the
    // revert runs (e.g. deleted by the user, or lost with a bad sector).
    std::fs::remove_file(drive_dir.path().join("archive/a.jpg")).unwrap();

    let revert_row_id = catalog
        .create_revert_job(drive.id, organize_job_id, 2)
        .await
        .unwrap();
    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("revert");
    let job = Arc::new(RevertJob::new(
        job_id.clone(),
        drive,
        revert_row_id,
        organize_items,
        deps(catalog.clone()),
    ));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let (ok, failed) = match terminal {
        JobEvent::Finished { ok, failed, .. } => (ok, failed),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    // b.jpg (organized second, reverted first) still succeeds despite
    // a.jpg's missing source.
    assert_eq!(ok, 1, "events: {events:?}");
    assert_eq!(failed, 1, "events: {events:?}");

    assert_eq!(
        std::fs::read(drive_dir.path().join("b.jpg")).unwrap(),
        b"content-b"
    );

    let (a_row, _) = catalog.get_media_with_drive(a_id).await.unwrap();
    assert_eq!(a_row.rel_path, "archive/a.jpg");
    assert!(a_row.organized_at.is_some());
}

#[tokio::test]
async fn cancelling_before_start_moves_nothing() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();

    let items = vec![planned(a_id, "a.jpg", "archive/a.jpg")];
    let (organize_job_id, organize_items) = run_organize(&catalog, drive.clone(), items).await;

    let revert_row_id = catalog
        .create_revert_job(drive.id, organize_job_id, 1)
        .await
        .unwrap();
    let job = RevertJob::new(
        "revert-precancel".into(),
        drive,
        revert_row_id,
        organize_items,
        deps(catalog.clone()),
    );

    let cancel = CancellationToken::new();
    cancel.cancel();
    let (tx, _rx) = mpsc::channel(64);
    let ctx = JobCtx { events: tx, cancel };

    let outcome = job.run(ctx).await.unwrap();
    assert!(outcome.cancelled);
    assert_eq!(outcome.ok + outcome.failed, 0);
    assert!(drive_dir.path().join("archive/a.jpg").exists());
    assert!(!drive_dir.path().join("a.jpg").exists());

    let job_row = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == revert_row_id)
        .unwrap();
    assert_eq!(job_row.status, "cancelled");
}

#[tokio::test]
async fn offline_drive_fails_the_job_and_finishes_the_job_row_as_failed() {
    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let mut drive = register_drive(&catalog, Path::new("/Volumes/Offline")).await;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();

    let organize_job_id = catalog.create_organize_job(drive.id, 1).await.unwrap();
    let item_rows = vec![OrganizeItemRow {
        id: 0,
        job_id: organize_job_id,
        media_id: a_id,
        old_rel_path: "a.jpg".into(),
        new_rel_path: "archive/a.jpg".into(),
        status: PlanStatus::Moved,
        error: None,
    }];

    // Simulate the drive being offline: no mount path.
    drive.mount_path = None;
    let revert_row_id = catalog
        .create_revert_job(drive.id, organize_job_id, 1)
        .await
        .unwrap();

    let job = RevertJob::new(
        "revert-offline".into(),
        drive,
        revert_row_id,
        item_rows,
        deps(catalog.clone()),
    );

    let (tx, _rx) = mpsc::channel(64);
    let ctx = JobCtx {
        events: tx,
        cancel: CancellationToken::new(),
    };

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
        .find(|j| j.id == revert_row_id)
        .unwrap();
    assert_eq!(job_row.status, "failed");
}

/// Sanity check: a `RevertJob` given only non-`Moved` items has nothing
/// to do and finishes immediately with everything at zero.
#[tokio::test]
async fn only_moved_items_are_ever_reverted() {
    let drive_dir = tempfile::tempdir().unwrap();
    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();

    let organize_job_id = catalog.create_organize_job(drive.id, 1).await.unwrap();
    let item_rows = vec![OrganizeItemRow {
        id: 0,
        job_id: organize_job_id,
        media_id: a_id,
        old_rel_path: "a.jpg".into(),
        new_rel_path: "a.jpg".into(),
        status: PlanStatus::SkippedDup,
        error: None,
    }];
    let revert_row_id = catalog
        .create_revert_job(drive.id, organize_job_id, 0)
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("revert");
    let job = Arc::new(RevertJob::new(
        job_id.clone(),
        drive,
        revert_row_id,
        item_rows,
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
    assert_eq!((ok, failed, skipped), (0, 0, 0));
}
