use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{Drive, DriveRole, NewDrive};
use dp_hash::{Blake3Hasher, Hasher};
use dp_jobs::{Job, JobCtx, JobEvent, JobRunner, ScanDeps, ScanJob};
use dp_metadata::ExiftoolProvider;
use dp_thumbs::{ThumbChain, ThumbStore};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

fn fx(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(name)
}

fn has_exiftool() -> bool {
    which::which("exiftool").is_ok()
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

fn default_deps(catalog: Arc<dyn Catalog>, store: Arc<ThumbStore>) -> ScanDeps {
    ScanDeps {
        catalog,
        hasher: Arc::new(Blake3Hasher),
        metadata: Arc::new(ExiftoolProvider::from_path()),
        thumbs: Arc::new(ThumbChain::default_chain()),
        store,
    }
}

async fn register_drive(catalog: &Arc<dyn Catalog>, name: &str, mount_path: &Path) -> Drive {
    catalog
        .register_drive(NewDrive {
            name: name.into(),
            mount_path: mount_path.to_string_lossy().into_owned(),
            role: DriveRole::Source,
            capacity: 1_000_000,
            free: 500_000,
        })
        .await
        .unwrap()
}

#[tokio::test]
async fn scans_drive_hashes_thumbnails_and_upserts_media() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("sample.jpg")).unwrap();
    std::fs::copy(fx("sample.png"), drive_dir.path().join("sample.png")).unwrap();
    std::fs::write(drive_dir.path().join("notes.txt"), b"just some notes").unwrap();
    std::fs::write(drive_dir.path().join("bad.jpg"), [0u8; 10]).unwrap();

    let jpg_before = std::fs::metadata(drive_dir.path().join("sample.jpg")).unwrap();
    let png_before = std::fs::metadata(drive_dir.path().join("sample.png")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = catalog
        .register_drive(NewDrive {
            name: "Test Drive".into(),
            mount_path: drive_dir.path().to_string_lossy().into_owned(),
            role: DriveRole::Source,
            capacity: 1_000_000,
            free: 500_000,
        })
        .await
        .unwrap();

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store.clone());

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id();
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, deps));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;

    let (ok, failed) = match terminal {
        JobEvent::Finished { ok, failed, .. } => (ok, failed),
        other => panic!("expected Finished, got {other:?}"),
    };
    assert_eq!(ok, 2, "events: {events:?}");
    assert_eq!(failed, 1, "events: {events:?}");

    let saw_bad_jpg_error = events
        .iter()
        .any(|e| matches!(e, JobEvent::ItemError { path, .. } if path.ends_with("bad.jpg")));
    assert!(
        saw_bad_jpg_error,
        "expected an ItemError for bad.jpg, got {events:?}"
    );

    assert_eq!(catalog.count_media(None).await.unwrap(), 3);

    let jpg_hash = Blake3Hasher.hash_file(&fx("sample.jpg")).await.unwrap();
    assert!(store.exists(&jpg_hash, 400));
    assert!(store.exists(&jpg_hash, 2000));

    let jpg_after = std::fs::metadata(drive_dir.path().join("sample.jpg")).unwrap();
    let png_after = std::fs::metadata(drive_dir.path().join("sample.png")).unwrap();
    assert_eq!(jpg_before.len(), jpg_after.len());
    assert_eq!(png_before.len(), png_after.len());
    assert_eq!(jpg_before.modified().unwrap(), jpg_after.modified().unwrap());
    assert_eq!(png_before.modified().unwrap(), png_after.modified().unwrap());
}

#[tokio::test]
async fn cancelling_immediately_emits_cancelled() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("sample.jpg")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = catalog
        .register_drive(NewDrive {
            name: "Cancel Drive".into(),
            mount_path: drive_dir.path().to_string_lossy().into_owned(),
            role: DriveRole::Source,
            capacity: 1_000_000,
            free: 500_000,
        })
        .await
        .unwrap();

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id();
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, deps));
    runner.spawn(job_id.clone(), job);
    runner.cancel(&job_id);

    let (_events, terminal) = drain_until_terminal(&mut rx).await;
    assert!(
        matches!(terminal, JobEvent::Cancelled { .. }),
        "expected Cancelled, got {terminal:?}"
    );
}

#[tokio::test]
async fn run_direct_with_pre_cancelled_token_flags_cancelled_and_processes_nothing() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("sample.jpg")).unwrap();
    std::fs::copy(fx("sample.png"), drive_dir.path().join("sample.png")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Direct Pre-Cancel Drive", drive_dir.path()).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let job = ScanJob::new("scan-direct-precancel".into(), drive, deps);

    // Cancel *before* run() is even called, isolating the "stopped early"
    // path from any race with the runner's own bookkeeping.
    let cancel = CancellationToken::new();
    cancel.cancel();
    let (tx, _rx) = mpsc::channel(64);
    let ctx = JobCtx { events: tx, cancel };

    let outcome = job.run(ctx).await.unwrap();

    assert!(outcome.cancelled, "expected cancelled=true, got {outcome:?}");
    assert_eq!(
        outcome.ok + outcome.failed,
        0,
        "expected no files processed when already cancelled, got {outcome:?}"
    );
}

#[tokio::test]
async fn run_direct_with_live_token_processes_everything_and_flags_not_cancelled() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("sample.jpg")).unwrap();
    std::fs::copy(fx("sample.png"), drive_dir.path().join("sample.png")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Direct Live Drive", drive_dir.path()).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let job = ScanJob::new("scan-direct-live".into(), drive, deps);

    // A token that is never cancelled — proves `cancelled` is derived from
    // an actual early exit, not merely the token's live/dead state.
    let (tx, _rx) = mpsc::channel(64);
    let ctx = JobCtx {
        events: tx,
        cancel: CancellationToken::new(),
    };

    let outcome = job.run(ctx).await.unwrap();

    assert!(!outcome.cancelled, "expected cancelled=false, got {outcome:?}");
    assert_eq!(
        outcome.ok + outcome.failed,
        2,
        "expected both files processed, got {outcome:?}"
    );
}
