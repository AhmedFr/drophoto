use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DpResult, Drive, DriveRole, MediaKind, NewDrive, NewMedia};
use dp_jobs::{Job, JobCtx, JobEvent, JobRunner, SidecarSyncDeps, SidecarSyncJob};
use dp_metadata::{ExiftoolSidecars, Sidecars};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

fn has_exiftool() -> bool {
    which::which("exiftool").is_ok()
}

fn nm(drive_id: i64, rel_path: &str, hash: &str) -> NewMedia {
    NewMedia {
        drive_id,
        rel_path: rel_path.into(),
        hash: hash.into(),
        size: 9,
        kind: MediaKind::Photo,
        ext: "jpg".into(),
        width: None,
        height: None,
        duration_ms: None,
        taken_at: None,
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

async fn register_drive(catalog: &Arc<dyn Catalog>, mount_path: &Path) -> Drive {
    catalog
        .register_drive(NewDrive {
            name: "Sidecar Sync Drive".into(),
            mount_path: mount_path.to_string_lossy().into_owned(),
            role: DriveRole::Source,
            capacity: 1_000_000,
            free: 500_000,
        })
        .await
        .unwrap()
}

fn deps(catalog: Arc<dyn Catalog>) -> SidecarSyncDeps {
    SidecarSyncDeps {
        catalog,
        sidecars: Arc::new(ExiftoolSidecars::from_path()),
        home: None,
    }
}

/// Drains `rx` until (and including) the terminal `Finished`/`Cancelled`
/// event, returning every event seen plus the terminal one.
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

/// Runs a [`SidecarSyncJob`] for `drive` to completion via a real
/// [`JobRunner`], returning every event seen plus the terminal one.
async fn run_sync(catalog: &Arc<dyn Catalog>, drive: Drive) -> (Vec<JobEvent>, JobEvent) {
    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("sidecar");
    let job = Arc::new(SidecarSyncJob::new(job_id.clone(), drive, deps(catalog.clone())));
    runner.spawn(job_id, job);
    drain_until_terminal(&mut rx).await
}

/// The ids still flagged `sidecar_pending` on `drive_id`, for asserting a
/// flag was (or wasn't) cleared.
async fn pending_ids(catalog: &Arc<dyn Catalog>, drive_id: i64) -> Vec<i64> {
    catalog
        .list_sidecar_pending(drive_id)
        .await
        .unwrap()
        .into_iter()
        .map(|r| r.id)
        .collect()
}

#[tokio::test]
async fn writes_pending_sidecars_and_clears_flags() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();
    std::fs::write(drive_dir.path().join("b.jpg"), b"content-b").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();
    let b_id = catalog.upsert_media(nm(drive.id, "b.jpg", "h-b")).await.unwrap();

    catalog
        .tag_media(&[a_id], &["Zebra".to_string(), "apple".to_string()], &[])
        .await
        .unwrap();
    catalog
        .tag_media(&[b_id], &["Solo".to_string()], &[])
        .await
        .unwrap();

    let (events, terminal) = run_sync(&catalog, drive.clone()).await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!((ok, failed, skipped), (2, 0, 0), "events: {events:?}");

    let sidecars = ExiftoolSidecars::from_path();
    let a_subjects = sidecars
        .read_subjects(&drive_dir.path().join("a.jpg"))
        .await
        .unwrap();
    assert_eq!(a_subjects, vec!["apple".to_string(), "Zebra".to_string()]);
    let b_subjects = sidecars
        .read_subjects(&drive_dir.path().join("b.jpg"))
        .await
        .unwrap();
    assert_eq!(b_subjects, vec!["Solo".to_string()]);

    assert!(pending_ids(&catalog, drive.id).await.is_empty());
}

#[tokio::test]
async fn denied_path_is_failed_and_flag_kept() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(drive_dir.path().join("Foo.app/Contents")).unwrap();
    std::fs::write(drive_dir.path().join("Foo.app/Contents/x.jpg"), b"content-x").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let x_id = catalog
        .upsert_media(nm(drive.id, "Foo.app/Contents/x.jpg", "h-x"))
        .await
        .unwrap();
    catalog
        .tag_media(&[x_id], &["tag".to_string()], &[])
        .await
        .unwrap();

    let (events, terminal) = run_sync(&catalog, drive.clone()).await;
    let (ok, failed) = match terminal {
        JobEvent::Finished { ok, failed, .. } => (ok, failed),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 0, "events: {events:?}");
    assert_eq!(failed, 1, "events: {events:?}");

    let saw_denied = events
        .iter()
        .any(|e| matches!(e, JobEvent::ItemError { code, .. } if code == "denied"));
    assert!(saw_denied, "expected a denied ItemError, got {events:?}");

    assert!(!drive_dir.path().join("Foo.app/Contents/x.jpg.xmp").exists());
    assert_eq!(pending_ids(&catalog, drive.id).await, vec![x_id]);
}

#[tokio::test]
async fn missing_file_is_failed_and_flag_kept() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();
    catalog
        .tag_media(&[a_id], &["tag".to_string()], &[])
        .await
        .unwrap();

    // The file is gone by the time the sync runs (deleted out-of-band).
    std::fs::remove_file(drive_dir.path().join("a.jpg")).unwrap();

    let (events, terminal) = run_sync(&catalog, drive.clone()).await;
    let (ok, failed) = match terminal {
        JobEvent::Finished { ok, failed, .. } => (ok, failed),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 0, "events: {events:?}");
    assert_eq!(failed, 1, "events: {events:?}");

    let saw_not_found = events
        .iter()
        .any(|e| matches!(e, JobEvent::ItemError { code, .. } if code == "not_found"));
    assert!(saw_not_found, "expected a not_found ItemError, got {events:?}");

    assert_eq!(pending_ids(&catalog, drive.id).await, vec![a_id]);
}

#[tokio::test]
async fn offline_drive_fails_job() {
    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let mut drive = register_drive(&catalog, Path::new("/Volumes/Offline")).await;
    // Simulate the drive being offline: no mount path.
    drive.mount_path = None;

    let job = SidecarSyncJob::new("sidecar-offline".into(), drive, deps(catalog.clone()));
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
}

/// A [`Sidecars`] decorator around the real [`ExiftoolSidecars`] that
/// cancels the running job — via the same [`JobRunner`] the test spawned
/// it on — right after it *finishes* writing `trigger_path`'s sidecar.
/// This lands the cancellation deterministically between two rows (rather
/// than racing a timer against a real `exiftool` subprocess): the
/// triggering row's own write already completed (so it's tallied `ok`)
/// by the time the flag flips, and [`SidecarSyncJob::run_inner`] only
/// ever re-checks cancellation at the top of its loop, so the next row is
/// never even looked at.
struct CancelAfter {
    inner: ExiftoolSidecars,
    trigger_path: PathBuf,
    runner: Arc<JobRunner>,
    job_id: String,
}

#[async_trait]
impl Sidecars for CancelAfter {
    async fn write_subjects(&self, media_path: &Path, subjects: &[String]) -> DpResult<()> {
        let result = self.inner.write_subjects(media_path, subjects).await;
        if media_path == self.trigger_path {
            self.runner.cancel(&self.job_id);
        }
        result
    }

    async fn read_subjects(&self, media_path: &Path) -> DpResult<Vec<String>> {
        self.inner.read_subjects(media_path).await
    }
}

#[tokio::test]
async fn cancel_stops_early() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::write(drive_dir.path().join("a.jpg"), b"content-a").unwrap();
    std::fs::write(drive_dir.path().join("b.jpg"), b"content-b").unwrap();
    // `list_sidecar_pending` orders by id, and `SidecarSyncJob` processes
    // rows in that order — a.jpg (inserted first) is always row one.
    let canonical_mount = std::fs::canonicalize(drive_dir.path()).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, drive_dir.path()).await;
    let a_id = catalog.upsert_media(nm(drive.id, "a.jpg", "h-a")).await.unwrap();
    let b_id = catalog.upsert_media(nm(drive.id, "b.jpg", "h-b")).await.unwrap();
    catalog
        .tag_media(&[a_id], &["one".to_string()], &[])
        .await
        .unwrap();
    catalog
        .tag_media(&[b_id], &["two".to_string()], &[])
        .await
        .unwrap();

    let (tx, mut rx) = mpsc::channel(64);
    let runner = Arc::new(JobRunner::new(tx));
    let job_id = runner.next_id("sidecar");

    let sidecars = Arc::new(CancelAfter {
        inner: ExiftoolSidecars::from_path(),
        trigger_path: canonical_mount.join("a.jpg"),
        runner: runner.clone(),
        job_id: job_id.clone(),
    });
    let deps = SidecarSyncDeps {
        catalog: catalog.clone(),
        sidecars,
        home: None,
    };
    let job = Arc::new(SidecarSyncJob::new(job_id.clone(), drive.clone(), deps));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Cancelled {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Cancelled, got {other:?} (events: {events:?})"),
    };
    assert_eq!((ok, failed, skipped), (1, 0, 0), "events: {events:?}");

    // a.jpg's sidecar was actually written; b.jpg was never touched.
    assert!(drive_dir.path().join("a.jpg.xmp").exists());
    assert!(!drive_dir.path().join("b.jpg.xmp").exists());

    assert_eq!(pending_ids(&catalog, drive.id).await, vec![b_id]);
}
