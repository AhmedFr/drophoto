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

/// `size` must match the real on-disk byte length of the file this
/// media row describes — `RevertJob`'s identity/size guard (see
/// `crates/dp-jobs/src/revert.rs`) compares the catalog's recorded
/// `size` against what's actually at `from` before ever moving it, so a
/// test that fabricates a mismatched size would (correctly) have every
/// one of its reverts fail. Use [`write`] to get a real, matching size.
fn nm(drive_id: i64, rel_path: &str, hash: &str, size: u64) -> NewMedia {
    NewMedia {
        drive_id,
        rel_path: rel_path.into(),
        hash: hash.into(),
        size,
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

/// Writes `content` at `path` and returns its byte length — the `size`
/// [`nm`] needs so the media row it builds matches the real file.
fn write(path: &Path, content: &[u8]) -> u64 {
    std::fs::write(path, content).unwrap();
    content.len() as u64
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

/// Runs a [`RevertJob`] over `items` to completion and returns the
/// terminal event.
async fn run_revert(
    catalog: &Arc<dyn Catalog>,
    drive: Drive,
    revert_row_id: i64,
    items: Vec<OrganizeItemRow>,
) -> (Vec<JobEvent>, JobEvent) {
    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("revert");
    let job = Arc::new(RevertJob::new(
        job_id.clone(),
        drive,
        revert_row_id,
        items,
        deps(catalog.clone()),
    ));
    runner.spawn(job_id, job);
    drain_until_terminal(&mut rx).await
}

#[tokio::test]
async fn reverts_moved_items_back_to_their_original_locations() {
    let drive_dir = tempfile::tempdir().unwrap();
    let a_size = write(&drive_dir.path().join("a.jpg"), b"content-a");
    let b_size = write(&drive_dir.path().join("b.jpg"), b"content-b");

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog
        .upsert_media(nm(drive.id, "a.jpg", "h-a", a_size))
        .await
        .unwrap();
    let b_id = catalog
        .upsert_media(nm(drive.id, "b.jpg", "h-b", b_size))
        .await
        .unwrap();

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
    let (events, terminal) = run_revert(&catalog, drive, revert_row_id, organize_items).await;
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
    let a_size = write(&drive_dir.path().join("a.jpg"), b"content-a");
    let b_size = write(&drive_dir.path().join("b.jpg"), b"content-b");

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog
        .upsert_media(nm(drive.id, "a.jpg", "h-a", a_size))
        .await
        .unwrap();
    let b_id = catalog
        .upsert_media(nm(drive.id, "b.jpg", "h-b", b_size))
        .await
        .unwrap();

    let items = vec![
        planned(a_id, "a.jpg", "archive/a.jpg"),
        planned(b_id, "b.jpg", "archive/b.jpg"),
    ];
    let (organize_job_id, organize_items) = run_organize(&catalog, drive.clone(), items).await;

    let revert_row_id = catalog
        .create_revert_job(drive.id, organize_job_id, 2)
        .await
        .unwrap();
    let (events, _terminal) = run_revert(&catalog, drive, revert_row_id, organize_items).await;
    let first_progress_path = events.iter().find_map(|e| match e {
        JobEvent::Progress { current, .. } => current.clone(),
        _ => None,
    });
    // b.jpg was organized second, so it must be reverted first.
    assert_eq!(first_progress_path.as_deref(), Some("archive/b.jpg"));
}

/// After a *successful* revert, the original job's own `organize_items`
/// rows are stale: replaying them again must not touch anything — the
/// item is already exactly where the revert would have put it, so it's
/// recorded `SkippedCollision` ("already reverted"), not re-moved and
/// not failed. A second revert over an already-fully-reverted job is
/// itself refused at the command layer (see `check_revertable`); this
/// test exercises the job's own handling of a stale item directly.
#[tokio::test]
async fn a_second_revert_over_an_already_reverted_item_skips_it_without_touching_anything() {
    let drive_dir = tempfile::tempdir().unwrap();
    let a_size = write(&drive_dir.path().join("a.jpg"), b"content-a");

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog
        .upsert_media(nm(drive.id, "a.jpg", "h-a", a_size))
        .await
        .unwrap();

    let items = vec![planned(a_id, "a.jpg", "archive/a.jpg")];
    let (organize_job_id, organize_items) = run_organize(&catalog, drive.clone(), items).await;

    // First revert: succeeds, restores a.jpg.
    let revert_row_id = catalog
        .create_revert_job(drive.id, organize_job_id, 1)
        .await
        .unwrap();
    let (_events, terminal) =
        run_revert(&catalog, drive.clone(), revert_row_id, organize_items.clone()).await;
    assert!(matches!(terminal, JobEvent::Finished { ok: 1, failed: 0, .. }));

    // Second revert attempt over the *same* (now-stale) organize items:
    // the catalog's rel_path is "a.jpg" again, and the real file is
    // sitting right there with the recorded size — already reverted,
    // must be skipped rather than treated as a conflict or a failure.
    let revert_row_id_2 = catalog
        .create_revert_job(drive.id, organize_job_id, 1)
        .await
        .unwrap();
    let (events2, terminal2) = run_revert(&catalog, drive, revert_row_id_2, organize_items).await;
    let (ok, skipped, failed) = match terminal2 {
        JobEvent::Finished {
            ok, skipped, failed, ..
        } => (ok, skipped, failed),
        other => panic!("expected Finished, got {other:?} (events: {events2:?})"),
    };
    assert_eq!((ok, skipped, failed), (0, 1, 0), "events: {events2:?}");

    let revert_items_2 = catalog.list_organize_items(revert_row_id_2, 10).await.unwrap();
    assert_eq!(revert_items_2.len(), 1);
    assert_eq!(revert_items_2[0].status, PlanStatus::SkippedCollision);
    assert_eq!(revert_items_2[0].error.as_deref(), Some("already reverted"));

    // A second attempt that only skipped already-reverted items must
    // still finish "done" (not "failed"), and this second revert row
    // itself now counts as the one that "reverted" the organize job.
    let job_row_2 = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == revert_row_id_2)
        .unwrap();
    assert_eq!(job_row_2.status, "done");

    assert_eq!(
        std::fs::read(drive_dir.path().join("a.jpg")).unwrap(),
        b"content-a"
    );
}

/// The identity check's actual purpose: a stale `organize_items` row
/// whose media has since been re-filed elsewhere (another organize run,
/// in this test simulated directly on the catalog) must never have its
/// revert move back whatever unrelated file now happens to occupy the
/// stale `new_rel_path` — that file is untouched, and the item fails.
#[tokio::test]
async fn media_reorganized_elsewhere_since_this_job_is_failed_and_the_occupying_file_is_untouched() {
    let drive_dir = tempfile::tempdir().unwrap();
    let a_size = write(&drive_dir.path().join("a.jpg"), b"content-a");

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog
        .upsert_media(nm(drive.id, "a.jpg", "h-a", a_size))
        .await
        .unwrap();

    let items = vec![planned(a_id, "a.jpg", "archive/a.jpg")];
    let (organize_job_id, organize_items) = run_organize(&catalog, drive.clone(), items).await;

    // Simulate a later, unrelated re-file of this same media (e.g. a
    // second organize run) without physically moving the file at
    // archive/a.jpg — exactly the "DB says one thing, the stale item
    // says another" scenario the identity check exists for.
    catalog
        .mark_media_organized(a_id, "archive/elsewhere.jpg")
        .await
        .unwrap();

    // And now something else entirely occupies the stale new_rel_path.
    std::fs::write(drive_dir.path().join("archive/a.jpg"), b"unrelated file").unwrap();

    let revert_row_id = catalog
        .create_revert_job(drive.id, organize_job_id, 1)
        .await
        .unwrap();
    let (events, terminal) = run_revert(&catalog, drive, revert_row_id, organize_items).await;
    let (ok, failed) = match terminal {
        JobEvent::Finished { ok, failed, .. } => (ok, failed),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 0, "events: {events:?}");
    assert_eq!(failed, 1, "events: {events:?}");

    let saw_conflict = events.iter().any(
        |e| matches!(e, JobEvent::ItemError { code, message, .. } if code == "conflict" && message == "media moved since this job"),
    );
    assert!(saw_conflict, "expected a conflict ItemError, got {events:?}");

    // The unrelated occupying file is untouched, and nothing was written
    // back to the original a.jpg location.
    assert_eq!(
        std::fs::read(drive_dir.path().join("archive/a.jpg")).unwrap(),
        b"unrelated file"
    );
    assert!(!drive_dir.path().join("a.jpg").exists());

    let (a_row, _) = catalog.get_media_with_drive(a_id).await.unwrap();
    assert_eq!(a_row.rel_path, "archive/elsewhere.jpg");
}

#[tokio::test]
async fn an_occupied_destination_is_failed_and_the_file_is_left_untouched() {
    let drive_dir = tempfile::tempdir().unwrap();
    let a_size = write(&drive_dir.path().join("a.jpg"), b"content-a");

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog
        .upsert_media(nm(drive.id, "a.jpg", "h-a", a_size))
        .await
        .unwrap();

    let items = vec![planned(a_id, "a.jpg", "archive/a.jpg")];
    let (organize_job_id, organize_items) = run_organize(&catalog, drive.clone(), items).await;

    // Something else now occupies the original path the revert would
    // restore to.
    std::fs::write(drive_dir.path().join("a.jpg"), b"someone else's file").unwrap();

    let revert_row_id = catalog
        .create_revert_job(drive.id, organize_job_id, 1)
        .await
        .unwrap();
    let (events, terminal) = run_revert(&catalog, drive, revert_row_id, organize_items).await;
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

    // The job row itself must read "failed" — not "done" — so a retry
    // stays possible, and the organize job it targeted must not be
    // reported as reverted.
    let job_row = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == revert_row_id)
        .unwrap();
    assert_eq!(job_row.status, "failed");

    let organize_row = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == organize_job_id)
        .unwrap();
    assert_eq!(
        organize_row.reverted_by_job_id, None,
        "a revert job that failed every item must not count as \"reverted\""
    );
}

/// A revert that fails every item (here: the destination is occupied)
/// must not block a later retry once the obstruction is cleared — the
/// job row reads "failed", `reverted_by_job_id` stays `None`, and a
/// second attempt is free to succeed.
#[tokio::test]
async fn a_revert_where_every_item_fails_does_not_block_a_retry() {
    let drive_dir = tempfile::tempdir().unwrap();
    let a_size = write(&drive_dir.path().join("a.jpg"), b"content-a");

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog
        .upsert_media(nm(drive.id, "a.jpg", "h-a", a_size))
        .await
        .unwrap();

    let items = vec![planned(a_id, "a.jpg", "archive/a.jpg")];
    let (organize_job_id, organize_items) = run_organize(&catalog, drive.clone(), items).await;

    // Occupy the destination so the first revert attempt fails outright.
    std::fs::write(drive_dir.path().join("a.jpg"), b"in the way").unwrap();

    let revert_row_id_1 = catalog
        .create_revert_job(drive.id, organize_job_id, 1)
        .await
        .unwrap();
    let (_events, terminal1) =
        run_revert(&catalog, drive.clone(), revert_row_id_1, organize_items.clone()).await;
    assert!(matches!(terminal1, JobEvent::Finished { ok: 0, failed: 1, .. }));

    let job_row_1 = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == revert_row_id_1)
        .unwrap();
    assert_eq!(job_row_1.status, "failed");

    let organize_row_after_failure = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == organize_job_id)
        .unwrap();
    assert_eq!(organize_row_after_failure.reverted_by_job_id, None);

    // Clear the obstruction and retry: same (untouched) organize items,
    // a fresh revert row.
    std::fs::remove_file(drive_dir.path().join("a.jpg")).unwrap();

    let revert_row_id_2 = catalog
        .create_revert_job(drive.id, organize_job_id, 1)
        .await
        .unwrap();
    let (_events2, terminal2) = run_revert(&catalog, drive, revert_row_id_2, organize_items).await;
    assert!(matches!(terminal2, JobEvent::Finished { ok: 1, failed: 0, .. }));

    let job_row_2 = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == revert_row_id_2)
        .unwrap();
    assert_eq!(job_row_2.status, "done");

    let organize_row_after_success = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == organize_job_id)
        .unwrap();
    assert_eq!(
        organize_row_after_success.reverted_by_job_id,
        Some(revert_row_id_2)
    );

    assert_eq!(
        std::fs::read(drive_dir.path().join("a.jpg")).unwrap(),
        b"content-a"
    );
}

/// The realistic shape of a retry: two items organized together, one
/// revert attempt manages the other but not the first (its destination
/// is occupied), and a second attempt — after the obstruction clears —
/// both finishes the still-outstanding item and recognizes the
/// already-reverted one as done rather than re-touching it.
#[tokio::test]
async fn a_retry_after_a_partial_revert_skips_the_already_reverted_item_and_finishes_the_rest() {
    let drive_dir = tempfile::tempdir().unwrap();
    let a_size = write(&drive_dir.path().join("a.jpg"), b"content-a");
    let b_size = write(&drive_dir.path().join("b.jpg"), b"content-b");

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog
        .upsert_media(nm(drive.id, "a.jpg", "h-a", a_size))
        .await
        .unwrap();
    let b_id = catalog
        .upsert_media(nm(drive.id, "b.jpg", "h-b", b_size))
        .await
        .unwrap();

    let items = vec![
        planned(a_id, "a.jpg", "archive/a.jpg"),
        planned(b_id, "b.jpg", "archive/b.jpg"),
    ];
    let (organize_job_id, organize_items) = run_organize(&catalog, drive.clone(), items).await;

    // Occupy b.jpg's original location so the revert fails on it —
    // items are reverted in reverse of the original order, so b.jpg is
    // attempted first and a.jpg second.
    std::fs::write(drive_dir.path().join("b.jpg"), b"in the way").unwrap();

    let revert_row_id_1 = catalog
        .create_revert_job(drive.id, organize_job_id, 2)
        .await
        .unwrap();
    let (_events1, terminal1) =
        run_revert(&catalog, drive.clone(), revert_row_id_1, organize_items.clone()).await;
    assert!(matches!(terminal1, JobEvent::Finished { ok: 1, failed: 1, .. }));

    // a.jpg really did come back; b.jpg is still organized (untouched).
    assert_eq!(
        std::fs::read(drive_dir.path().join("a.jpg")).unwrap(),
        b"content-a"
    );
    assert_eq!(
        std::fs::read(drive_dir.path().join("archive/b.jpg")).unwrap(),
        b"content-b"
    );

    let organize_row_after_failure = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == organize_job_id)
        .unwrap();
    assert_eq!(organize_row_after_failure.reverted_by_job_id, None);

    // Clear the obstruction and retry with the same (untouched) organize
    // items.
    std::fs::remove_file(drive_dir.path().join("b.jpg")).unwrap();

    let revert_row_id_2 = catalog
        .create_revert_job(drive.id, organize_job_id, 2)
        .await
        .unwrap();
    let (events2, terminal2) = run_revert(&catalog, drive, revert_row_id_2, organize_items).await;
    let (ok, skipped, failed) = match terminal2 {
        JobEvent::Finished {
            ok, skipped, failed, ..
        } => (ok, skipped, failed),
        other => panic!("expected Finished, got {other:?} (events: {events2:?})"),
    };
    assert_eq!((ok, skipped, failed), (1, 1, 0), "events: {events2:?}");

    let revert_items_2 = catalog.list_organize_items(revert_row_id_2, 10).await.unwrap();
    let a_item = revert_items_2.iter().find(|i| i.media_id == a_id).unwrap();
    assert_eq!(a_item.status, PlanStatus::SkippedCollision);
    assert_eq!(a_item.error.as_deref(), Some("already reverted"));
    let b_item = revert_items_2.iter().find(|i| i.media_id == b_id).unwrap();
    assert_eq!(b_item.status, PlanStatus::Moved);

    let job_row_2 = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == revert_row_id_2)
        .unwrap();
    assert_eq!(job_row_2.status, "done");

    let organize_row_after_success = catalog
        .list_organize_jobs(10)
        .await
        .unwrap()
        .into_iter()
        .find(|j| j.id == organize_job_id)
        .unwrap();
    assert_eq!(
        organize_row_after_success.reverted_by_job_id,
        Some(revert_row_id_2)
    );

    assert_eq!(
        std::fs::read(drive_dir.path().join("b.jpg")).unwrap(),
        b"content-b"
    );
}

#[tokio::test]
async fn a_missing_source_is_failed_and_the_job_continues() {
    let drive_dir = tempfile::tempdir().unwrap();
    let a_size = write(&drive_dir.path().join("a.jpg"), b"content-a");
    let b_size = write(&drive_dir.path().join("b.jpg"), b"content-b");

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog
        .upsert_media(nm(drive.id, "a.jpg", "h-a", a_size))
        .await
        .unwrap();
    let b_id = catalog
        .upsert_media(nm(drive.id, "b.jpg", "h-b", b_size))
        .await
        .unwrap();

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
    let (events, terminal) = run_revert(&catalog, drive, revert_row_id, organize_items).await;
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

/// A file whose bytes changed underneath it (same `rel_path`, but not
/// the content the catalog last recorded a size for) must not be
/// silently moved back — even though the identity check alone would let
/// it through.
#[tokio::test]
async fn a_size_mismatch_is_failed_and_the_file_is_left_untouched() {
    let drive_dir = tempfile::tempdir().unwrap();
    let a_size = write(&drive_dir.path().join("a.jpg"), b"content-a");

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog
        .upsert_media(nm(drive.id, "a.jpg", "h-a", a_size))
        .await
        .unwrap();

    let items = vec![planned(a_id, "a.jpg", "archive/a.jpg")];
    let (organize_job_id, organize_items) = run_organize(&catalog, drive.clone(), items).await;

    // The file at its organized location changed size after the fact —
    // rel_path still matches, but the bytes don't.
    std::fs::write(
        drive_dir.path().join("archive/a.jpg"),
        b"a much longer replacement body",
    )
    .unwrap();

    let revert_row_id = catalog
        .create_revert_job(drive.id, organize_job_id, 1)
        .await
        .unwrap();
    let (events, terminal) = run_revert(&catalog, drive, revert_row_id, organize_items).await;
    let (ok, failed) = match terminal {
        JobEvent::Finished { ok, failed, .. } => (ok, failed),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 0, "events: {events:?}");
    assert_eq!(failed, 1, "events: {events:?}");

    let saw_size_mismatch = events.iter().any(
        |e| matches!(e, JobEvent::ItemError { code, message, .. } if code == "conflict" && message == "size mismatch"),
    );
    assert!(
        saw_size_mismatch,
        "expected a size-mismatch ItemError, got {events:?}"
    );

    assert_eq!(
        std::fs::read(drive_dir.path().join("archive/a.jpg")).unwrap(),
        b"a much longer replacement body"
    );
    assert!(!drive_dir.path().join("a.jpg").exists());
}

#[tokio::test]
async fn cancelling_before_start_moves_nothing() {
    let drive_dir = tempfile::tempdir().unwrap();
    let a_size = write(&drive_dir.path().join("a.jpg"), b"content-a");

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog
        .upsert_media(nm(drive.id, "a.jpg", "h-a", a_size))
        .await
        .unwrap();

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
    let a_id = catalog
        .upsert_media(nm(drive.id, "a.jpg", "h-a", 9))
        .await
        .unwrap();

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
    let a_id = catalog
        .upsert_media(nm(drive.id, "a.jpg", "h-a", 9))
        .await
        .unwrap();

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

    let (events, terminal) = run_revert(&catalog, drive, revert_row_id, item_rows).await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!((ok, failed, skipped), (0, 0, 0));
}

/// A media move's `.xmp` sidecar must travel with it on the way back,
/// too: organize moves `a.jpg` + `a.jpg.xmp` under `archive/...`
/// (Task 4a.6 also wires the sidecar into `OrganizeJob`), and reverting
/// must land both back at their original locations.
#[tokio::test]
async fn revert_moves_the_sidecar_back() {
    let drive_dir = tempfile::tempdir().unwrap();
    let a_size = write(&drive_dir.path().join("a.jpg"), b"content-a");
    write(&drive_dir.path().join("a.jpg.xmp"), b"<xmp/>");

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog
        .upsert_media(nm(drive.id, "a.jpg", "h-a", a_size))
        .await
        .unwrap();

    let items = vec![planned(a_id, "a.jpg", "archive/2025/Q3/2025-09-12_a.jpg")];
    let (organize_job_id, organize_items) = run_organize(&catalog, drive.clone(), items).await;

    // Sanity: the organize setup really did move both the file and its
    // sidecar.
    assert!(drive_dir.path().join("archive/2025/Q3/2025-09-12_a.jpg").exists());
    assert!(drive_dir
        .path()
        .join("archive/2025/Q3/2025-09-12_a.jpg.xmp")
        .exists());
    assert!(!drive_dir.path().join("a.jpg").exists());
    assert!(!drive_dir.path().join("a.jpg.xmp").exists());

    let revert_row_id = catalog
        .create_revert_job(drive.id, organize_job_id, 1)
        .await
        .unwrap();
    let (events, terminal) = run_revert(&catalog, drive, revert_row_id, organize_items).await;
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
        std::fs::read(drive_dir.path().join("a.jpg")).unwrap(),
        b"content-a"
    );
    assert_eq!(
        std::fs::read(drive_dir.path().join("a.jpg.xmp")).unwrap(),
        b"<xmp/>"
    );
    assert!(!drive_dir.path().join("archive/2025/Q3/2025-09-12_a.jpg").exists());
    assert!(!drive_dir
        .path()
        .join("archive/2025/Q3/2025-09-12_a.jpg.xmp")
        .exists());

    let (a_row, _) = catalog.get_media_with_drive(a_id).await.unwrap();
    assert!(!a_row.sidecar_pending);
}

/// A media item with no `.xmp` sidecar must produce no sidecar-related
/// events during a revert either.
#[tokio::test]
async fn revert_without_a_sidecar_emits_no_sidecar_events() {
    let drive_dir = tempfile::tempdir().unwrap();
    let a_size = write(&drive_dir.path().join("a.jpg"), b"content-a");

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog
        .upsert_media(nm(drive.id, "a.jpg", "h-a", a_size))
        .await
        .unwrap();

    let items = vec![planned(a_id, "a.jpg", "archive/2025/Q3/2025-09-12_a.jpg")];
    let (organize_job_id, organize_items) = run_organize(&catalog, drive.clone(), items).await;

    let revert_row_id = catalog
        .create_revert_job(drive.id, organize_job_id, 1)
        .await
        .unwrap();
    let (events, terminal) = run_revert(&catalog, drive, revert_row_id, organize_items).await;
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

/// If the sidecar's own move back fails — here, because something else
/// already occupies its original location — the media item itself must
/// still read `Moved` (the media move already succeeded), the job's own
/// tallies must be unaffected, and the row must be left
/// `sidecar_pending` so a later sync job recreates the sidecar.
#[tokio::test]
async fn revert_sidecar_move_failure_marks_pending_not_failed() {
    let drive_dir = tempfile::tempdir().unwrap();
    let a_size = write(&drive_dir.path().join("a.jpg"), b"content-a");
    write(&drive_dir.path().join("a.jpg.xmp"), b"<xmp/>");

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog
        .upsert_media(nm(drive.id, "a.jpg", "h-a", a_size))
        .await
        .unwrap();

    let items = vec![planned(a_id, "a.jpg", "archive/2025/Q3/2025-09-12_a.jpg")];
    let (organize_job_id, organize_items) = run_organize(&catalog, drive.clone(), items).await;
    assert!(drive_dir
        .path()
        .join("archive/2025/Q3/2025-09-12_a.jpg.xmp")
        .exists());

    // Pre-create a *directory* at the sidecar's revert destination
    // (`a.jpg.xmp`) so the sidecar's own move back fails, while `a.jpg`
    // itself is left free.
    std::fs::create_dir_all(drive_dir.path().join("a.jpg.xmp")).unwrap();

    let revert_row_id = catalog
        .create_revert_job(drive.id, organize_job_id, 1)
        .await
        .unwrap();
    let (events, terminal) = run_revert(&catalog, drive, revert_row_id, organize_items).await;
    let (ok, failed) = match terminal {
        JobEvent::Finished { ok, failed, .. } => (ok, failed),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 1, "events: {events:?}");
    assert_eq!(failed, 0, "events: {events:?}");

    let saw_sidecar_error = events
        .iter()
        .any(|e| matches!(e, JobEvent::ItemError { code, .. } if code == "sidecar"));
    assert!(
        saw_sidecar_error,
        "expected a \"sidecar\" ItemError, got {events:?}"
    );

    // The media file itself moved back.
    assert_eq!(
        std::fs::read(drive_dir.path().join("a.jpg")).unwrap(),
        b"content-a"
    );
    // The sidecar was left behind under archive/..., since the move
    // back failed.
    assert_eq!(
        std::fs::read(drive_dir.path().join("archive/2025/Q3/2025-09-12_a.jpg.xmp")).unwrap(),
        b"<xmp/>"
    );

    let revert_items = catalog.list_organize_items(revert_row_id, 10).await.unwrap();
    assert_eq!(revert_items.len(), 1);
    assert_eq!(revert_items[0].status, PlanStatus::Moved);

    let (a_row, _) = catalog.get_media_with_drive(a_id).await.unwrap();
    assert!(a_row.sidecar_pending);
}
