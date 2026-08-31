use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{
    DpResult, Drive, DriveRole, MediaKind, MediaRow, NewDrive, NewMedia, NewSource, ScanIndexEntry, Source,
};
use dp_hash::{Blake3Hasher, Hasher};
use dp_jobs::{Job, JobCtx, JobEvent, JobRunner, ScanDeps, ScanJob};
use dp_metadata::{ExiftoolProvider, ExiftoolSidecars, Sidecars};
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

/// An empty skip index — every test that isn't specifically exercising
/// incremental-rescan behaviour scans as if nothing was ever indexed
/// before (the same as passing `full: true` at the command layer).
fn no_index() -> HashMap<String, ScanIndexEntry> {
    HashMap::new()
}

/// The real skip index for `drive_id`, as a scan would load it: every
/// existing row keyed by `rel_path`.
async fn scan_index(catalog: &Arc<dyn Catalog>, drive_id: i64) -> HashMap<String, ScanIndexEntry> {
    catalog
        .list_scan_index(drive_id)
        .await
        .unwrap()
        .into_iter()
        .map(|e| (e.rel_path.clone(), e))
        .collect()
}

#[cfg(unix)]
fn is_root() -> bool {
    std::process::Command::new("id")
        .arg("-u")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "0")
        .unwrap_or(false)
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
        sidecars: Arc::new(ExiftoolSidecars::from_path()),
        home: None,
    }
}

/// A [`Hasher`] wrapper that counts every `hash_file` call while
/// delegating the real work to [`Blake3Hasher`] — the incremental-rescan
/// tests use this to prove a skipped file is never hashed at all.
struct CountingHasher {
    calls: Arc<AtomicU64>,
}

#[async_trait::async_trait]
impl Hasher for CountingHasher {
    async fn hash_file(&self, path: &Path) -> DpResult<String> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Blake3Hasher.hash_file(path).await
    }
}

/// A [`Sidecars`] wrapper that counts every `read_subjects` call while
/// delegating the real work to a fresh [`ExiftoolSidecars`] — the
/// sidecar-convergence tests use this to prove a rescan that shouldn't
/// treat a sidecar as newer never actually re-reads it via exiftool.
/// `write_subjects` is passed through uncounted (only reads are the
/// concern here).
struct CountingSidecars {
    reads: Arc<AtomicU64>,
}

#[async_trait::async_trait]
impl Sidecars for CountingSidecars {
    async fn write_subjects(&self, media_path: &Path, subjects: &[String]) -> DpResult<()> {
        ExiftoolSidecars::from_path()
            .write_subjects(media_path, subjects)
            .await
    }

    async fn read_subjects(&self, media_path: &Path) -> DpResult<Vec<String>> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        ExiftoolSidecars::from_path().read_subjects(media_path).await
    }
}

/// Forces `path`'s mtime to match `reference`'s, at second precision, via
/// the `touch` binary — used to isolate the skip rule's `size` check from
/// its `mtime` check in a real-filesystem test: rewriting a file's
/// content with `std::fs::write` always bumps its mtime too, so proving
/// "size changed" alone requires putting the old mtime back afterwards.
/// macOS/BSD `touch -t [[CC]YY]MMDDhhmm[.SS]` interprets its argument in
/// local time, hence formatting `reference`'s mtime as a `Local`
/// timestamp here.
/// `row` as a [`NewMedia`] with its `mtime` nulled back out — re-upserting
/// this simulates a row that predates the `mtime` column (or the
/// incremental-rescan feature entirely), which must always be reprocessed
/// once rather than trusted.
fn null_out_mtime(row: &MediaRow) -> NewMedia {
    NewMedia {
        drive_id: row.drive_id,
        rel_path: row.rel_path.clone(),
        hash: row.hash.clone(),
        size: row.size,
        kind: row.kind,
        ext: row.ext.clone(),
        width: row.width,
        height: row.height,
        duration_ms: row.duration_ms,
        taken_at: row.taken_at,
        camera: row.camera.clone(),
        lens: row.lens.clone(),
        aperture: row.aperture,
        shutter: row.shutter,
        iso: row.iso,
        focal_mm: row.focal_mm,
        lat: row.lat,
        lon: row.lon,
        organized_at: row.organized_at,
        source_id: row.source_id,
        mtime: None,
    }
}

fn force_mtime_to_match(path: &Path, reference_mtime: std::time::SystemTime) {
    let local: chrono::DateTime<chrono::Local> = reference_mtime.into();
    let touch_arg = local.format("%Y%m%d%H%M.%S").to_string();
    let status = std::process::Command::new("touch")
        .arg("-t")
        .arg(touch_arg)
        .arg(path)
        .status()
        .expect("failed to run touch");
    assert!(status.success(), "touch -t failed for {}", path.display());
}

/// Spawns and drains a [`ScanJob`] built from `drive`/`sources`/`deps`/
/// `skip_index`, returning every event seen plus the terminal one —
/// shared by the incremental-rescan tests below, which each need to run
/// more than one scan of the same drive.
async fn run_scan(
    drive: Drive,
    sources: Vec<Source>,
    deps: ScanDeps,
    skip_index: HashMap<String, ScanIndexEntry>,
) -> (Vec<JobEvent>, JobEvent) {
    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, sources, deps, skip_index));
    runner.spawn(job_id, job);
    drain_until_terminal(&mut rx).await
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

/// Registers (or re-enables) a source at `rel_path` for `drive_id`.
async fn source(catalog: &Arc<dyn Catalog>, drive_id: i64, rel_path: &str) -> Source {
    catalog
        .upsert_source(NewSource {
            drive_id,
            rel_path: rel_path.into(),
        })
        .await
        .unwrap()
}

/// A single source rooted at the mount itself — the common case for tests
/// that don't care about sub-sources.
async fn root_source(catalog: &Arc<dyn Catalog>, drive_id: i64) -> Source {
    source(catalog, drive_id, "").await
}

/// A media row as it would have been written before sources existed:
/// `source_id: None`. There's no file behind it — the point is the row.
fn legacy_media(drive_id: i64, rel_path: &str, hash: &str) -> NewMedia {
    NewMedia {
        drive_id,
        rel_path: rel_path.into(),
        hash: hash.into(),
        size: 1024,
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
        mtime: None,
        source_id: None,
    }
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
    // Well under STUB_MAX_BYTES (8192) — a thumbnail failure on this file
    // must be treated as a stub: not inserted, reported as `ItemError{code:
    // "stub"}`, and counted as skipped rather than failed.
    std::fs::write(drive_dir.path().join("bad.jpg"), [0u8; 10]).unwrap();

    let jpg_before = std::fs::metadata(drive_dir.path().join("sample.jpg")).unwrap();
    let png_before = std::fs::metadata(drive_dir.path().join("sample.png")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Test Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store.clone());

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![src], deps, no_index()));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;

    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?}"),
    };
    assert_eq!(ok, 2, "events: {events:?}");
    assert_eq!(failed, 0, "events: {events:?}");
    assert_eq!(skipped, 1, "events: {events:?}");

    let saw_stub_error = events.iter().any(|e| {
        matches!(e, JobEvent::ItemError { path, code, .. } if path.ends_with("bad.jpg") && code == "stub")
    });
    assert!(
        saw_stub_error,
        "expected an ItemError{{code: \"stub\"}} for bad.jpg, got {events:?}"
    );

    // Only the two real media files were cataloged — the stub was not.
    assert_eq!(catalog.count_media(None).await.unwrap(), 2);

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

/// `JobRunner::with_recorder`'s scan-specific counters: `bytes_read` must
/// equal the sum of every fixture file's on-disk size (each is hashed
/// exactly once), and `bytes_written` must be nonzero (every real file
/// gets thumbnails rendered and written at each of `THUMB_SIZES`).
#[tokio::test]
async fn scan_records_bytes_read_and_bytes_written_via_the_recorder() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("sample.jpg")).unwrap();
    std::fs::copy(fx("sample.png"), drive_dir.path().join("sample.png")).unwrap();
    let jpg_size = std::fs::metadata(drive_dir.path().join("sample.jpg"))
        .unwrap()
        .len();
    let png_size = std::fs::metadata(drive_dir.path().join("sample.png"))
        .unwrap()
        .len();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Bytes Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx).with_recorder(catalog.clone());
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![src], deps, no_index()));
    runner.spawn(job_id.clone(), job);

    drain_until_terminal(&mut rx).await;

    let run = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let runs = catalog.list_job_runs(10).await.unwrap();
            if let Some(run) = runs.into_iter().find(|r| r.job_id == job_id) {
                return run;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("timed out waiting for the job run to be recorded");

    assert_eq!(
        run.bytes_read,
        jpg_size + png_size,
        "bytes_read should equal the sum of every hashed fixture's size"
    );
    assert!(run.bytes_written > 0, "expected thumbnails to have been written");
    assert_eq!(run.status, "done");
}

/// A media row scanned before sources existed (`source_id: NULL`) that
/// points somewhere today's deny-list refuses can never be re-created
/// *or* resolved by a scan — the walk skips exactly those paths — so a
/// scan prunes it instead of leaving it stuck in the UI's "re-scan to
/// include these" count forever. Legacy rows under ordinary folders are
/// untouched: those *are* still resolvable by a re-scan.
#[tokio::test]
async fn a_scan_prunes_legacy_rows_under_denied_paths_and_keeps_the_rest() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(drive_dir.path().join("Pictures")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Legacy Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    // Both rows predate sources: `source_id: None`.
    let denied_id = catalog
        .upsert_media(legacy_media(drive.id, "Foo.app/Contents/old.jpg", "h-denied"))
        .await
        .unwrap();
    let kept_id = catalog
        .upsert_media(legacy_media(drive.id, "Pictures/old.jpg", "h-kept"))
        .await
        .unwrap();

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(
        job_id.clone(),
        drive.clone(),
        vec![src],
        deps,
        no_index(),
    ));
    runner.spawn(job_id, job);
    drain_until_terminal(&mut rx).await;

    let remaining: Vec<i64> = catalog
        .list_media_without_source(drive.id)
        .await
        .unwrap()
        .into_iter()
        .map(|m| m.id)
        .collect();
    assert!(
        !remaining.contains(&denied_id),
        "the legacy row under Foo.app should have been pruned, got {remaining:?}"
    );
    assert!(
        remaining.contains(&kept_id),
        "the legacy row under Pictures/ must survive, got {remaining:?}"
    );
}

#[tokio::test]
async fn cancelling_immediately_emits_cancelled() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("sample.jpg")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Cancel Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![src], deps, no_index()));
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
                "no file was processed before the cancel landed, so the tallies should be zero"
            );
        }
        other => panic!("expected Cancelled, got {other:?}"),
    }
}

/// The `job_runs` counterpart of [`cancelling_immediately_emits_cancelled`]:
/// a scan cancelled before it processes anything must be recorded with
/// `status: "cancelled"`, not `"done"` or `"failed"`.
#[tokio::test]
async fn cancelling_immediately_records_status_cancelled() {
    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("sample.jpg")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Cancel Recorder Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx).with_recorder(catalog.clone());
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![src], deps, no_index()));
    runner.spawn(job_id.clone(), job);
    runner.cancel(&job_id);

    drain_until_terminal(&mut rx).await;

    let run = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let runs = catalog.list_job_runs(10).await.unwrap();
            if let Some(run) = runs.into_iter().find(|r| r.job_id == job_id) {
                return run;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("timed out waiting for the job run to be recorded");

    assert_eq!(run.status, "cancelled");
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
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let job = ScanJob::new("scan-direct-precancel".into(), drive, vec![src], deps, no_index());

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
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let job = ScanJob::new("scan-direct-live".into(), drive, vec![src], deps, no_index());

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

#[cfg(unix)]
#[tokio::test]
async fn unreadable_subdirectory_is_reported_as_an_io_item_error() {
    use std::os::unix::fs::PermissionsExt;

    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }
    if is_root() {
        eprintln!("skipping: running as root, chmod 000 has no effect");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("sample.jpg")).unwrap();

    let locked = drive_dir.path().join("locked");
    std::fs::create_dir(&locked).unwrap();
    std::fs::copy(fx("sample.png"), locked.join("sample.png")).unwrap();

    let mut perms = std::fs::metadata(&locked).unwrap().permissions();
    perms.set_mode(0o000);
    std::fs::set_permissions(&locked, perms).unwrap();

    // Ensures the directory is readable again before the tempdir is
    // dropped (and cleaned up), regardless of how the test exits.
    struct RestorePerms(PathBuf);
    impl Drop for RestorePerms {
        fn drop(&mut self) {
            if let Ok(meta) = std::fs::metadata(&self.0) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(&self.0, perms);
            }
        }
    }
    let _restore = RestorePerms(locked);

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Locked Subdir Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![src], deps, no_index()));
    runner.spawn(job_id, job);

    let (events, _terminal) = drain_until_terminal(&mut rx).await;

    let saw_io_error = events
        .iter()
        .any(|e| matches!(e, JobEvent::ItemError { code, .. } if code == "io"));
    assert!(
        saw_io_error,
        "expected an ItemError with code \"io\", got {events:?}"
    );
}

#[tokio::test]
async fn scan_with_two_sources_only_indexes_those_trees() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(drive_dir.path().join("DCIM")).unwrap();
    std::fs::create_dir_all(drive_dir.path().join("Pictures")).unwrap();
    std::fs::create_dir_all(drive_dir.path().join("Ignored")).unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("DCIM/a.jpg")).unwrap();
    std::fs::copy(fx("sample.png"), drive_dir.path().join("Pictures/b.png")).unwrap();
    // Sits outside both configured sources — must never be scanned.
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("Ignored/c.jpg")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Two Source Drive", drive_dir.path()).await;
    let dcim = source(&catalog, drive.id, "DCIM").await;
    let pictures = source(&catalog, drive.id, "Pictures").await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(
        job_id.clone(),
        drive,
        vec![dcim.clone(), pictures.clone()],
        deps,
        no_index(),
    ));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let ok = match terminal {
        JobEvent::Finished { ok, .. } => ok,
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 2, "events: {events:?}");
    assert_eq!(catalog.count_media(None).await.unwrap(), 2);

    let rows = catalog.list_media(10, 0).await.unwrap();
    let mut by_rel_path: Vec<(&str, Option<i64>)> =
        rows.iter().map(|r| (r.rel_path.as_str(), r.source_id)).collect();
    by_rel_path.sort();
    assert_eq!(
        by_rel_path,
        [
            ("DCIM/a.jpg", Some(dcim.id)),
            ("Pictures/b.png", Some(pictures.id))
        ],
        "each row must be attributed to the specific source that indexed it"
    );
}

#[tokio::test]
async fn denied_subdir_inside_a_source_is_skipped() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(drive_dir.path().join("DCIM/node_modules")).unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("DCIM/a.jpg")).unwrap();
    // "node_modules" is on the deny-list anywhere in the tree — this file
    // must never be scanned even though it's inside a configured source.
    std::fs::copy(fx("sample.png"), drive_dir.path().join("DCIM/node_modules/b.png")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Denylist Drive", drive_dir.path()).await;
    let dcim = source(&catalog, drive.id, "DCIM").await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![dcim], deps, no_index()));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let ok = match terminal {
        JobEvent::Finished { ok, .. } => ok,
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 1, "events: {events:?}");
    assert_eq!(catalog.count_media(None).await.unwrap(), 1);
    let rows = catalog.list_media(10, 0).await.unwrap();
    assert_eq!(rows[0].rel_path, "DCIM/a.jpg");
}

#[tokio::test]
async fn nested_sources_are_deduped_keeping_the_shallowest() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(drive_dir.path().join("DCIM")).unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("DCIM/a.jpg")).unwrap();
    // Only reachable via the root source — proves the walk isn't somehow
    // restricted to just the nested "DCIM" source instead.
    std::fs::copy(fx("sample.png"), drive_dir.path().join("b.png")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Nested Source Drive", drive_dir.path()).await;
    // Both the mount root ("") and "DCIM" (nested inside it) are enabled
    // — "DCIM" must be dropped as a duplicate of the root walk, so
    // DCIM/a.jpg is indexed exactly once, attributed to the root source.
    let root = root_source(&catalog, drive.id).await;
    let dcim = source(&catalog, drive.id, "DCIM").await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(
        job_id.clone(),
        drive,
        vec![root.clone(), dcim.clone()],
        deps,
        no_index(),
    ));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let ok = match terminal {
        JobEvent::Finished { ok, .. } => ok,
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(
        ok, 2,
        "each file must be indexed exactly once, events: {events:?}"
    );
    assert_eq!(catalog.count_media(None).await.unwrap(), 2);

    let saw_total_two = events
        .iter()
        .any(|e| matches!(e, JobEvent::Progress { total: 2, .. }));
    assert!(
        saw_total_two,
        "expected a Progress event with total==2 (no double-count from the nested source), got {events:?}"
    );

    let rows = catalog.list_media(10, 0).await.unwrap();
    for row in &rows {
        assert_eq!(
            row.source_id,
            Some(root.id),
            "every row must be attributed to the shallowest surviving (root) source, got {row:?}"
        );
    }
}

/// Whether `dir` sits on a case-insensitive filesystem: creates a probe
/// subdirectory and checks whether it can also be opened via a
/// differently-cased name. macOS's default (APFS) is case-insensitive,
/// but this isn't guaranteed (a case-sensitive APFS volume, or CI running
/// on a different OS), so the test that relies on this skips itself
/// rather than assuming.
fn tempdir_is_case_insensitive(dir: &Path) -> bool {
    let probe = dir.join("CaseInsensitivityProbe");
    std::fs::create_dir_all(&probe).unwrap();
    std::fs::metadata(dir.join("caseinsensitivityprobe")).is_ok()
}

#[tokio::test]
async fn case_insensitive_duplicate_sources_are_walked_once() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    if !tempdir_is_case_insensitive(drive_dir.path()) {
        eprintln!("skipping: tempdir filesystem is case-sensitive");
        return;
    }

    std::fs::create_dir_all(drive_dir.path().join("DCIM")).unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("DCIM/a.jpg")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Case Insensitive Drive", drive_dir.path()).await;
    // Same real directory, two different-cased configured sources — must
    // be walked (and cataloged) exactly once, not twice.
    let upper = source(&catalog, drive.id, "DCIM").await;
    let lower = source(&catalog, drive.id, "dcim").await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(
        job_id.clone(),
        drive,
        vec![upper, lower],
        deps,
        no_index(),
    ));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let ok = match terminal {
        JobEvent::Finished { ok, .. } => ok,
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 1, "the file must be indexed exactly once, events: {events:?}");
    assert_eq!(catalog.count_media(None).await.unwrap(), 1);
}

#[cfg(unix)]
#[tokio::test]
async fn symlinked_duplicate_source_is_walked_once_without_panicking() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(drive_dir.path().join("DCIM")).unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("DCIM/a.jpg")).unwrap();
    std::os::unix::fs::symlink(drive_dir.path().join("DCIM"), drive_dir.path().join("link")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Symlink Source Drive", drive_dir.path()).await;
    // "link" canonicalizes to the same real directory as "DCIM" — must be
    // walked (and cataloged) exactly once, not twice, and must not panic
    // (walkdir doesn't follow symlinks by default, and canonicalizing a
    // symlinked root must not trip up the containment check).
    let dcim = source(&catalog, drive.id, "DCIM").await;
    let link = source(&catalog, drive.id, "link").await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(
        job_id.clone(),
        drive,
        vec![dcim, link],
        deps,
        no_index(),
    ));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let ok = match terminal {
        JobEvent::Finished { ok, .. } => ok,
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(
        ok, 1,
        "no duplicate rows from the symlinked source, events: {events:?}"
    );
    assert_eq!(catalog.count_media(None).await.unwrap(), 1);
}

#[tokio::test]
async fn missing_source_root_reports_io_error_but_other_sources_still_scanned() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(drive_dir.path().join("Pictures")).unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("Pictures/a.jpg")).unwrap();
    // "Missing" is never created on disk — its root can't be canonicalized.

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Missing Source Drive", drive_dir.path()).await;
    let pictures = source(&catalog, drive.id, "Pictures").await;
    let missing = source(&catalog, drive.id, "Missing").await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(
        job_id.clone(),
        drive,
        vec![pictures, missing],
        deps,
        no_index(),
    ));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let ok = match terminal {
        JobEvent::Finished { ok, .. } => ok,
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(
        ok, 1,
        "the existing source must still be scanned, events: {events:?}"
    );

    let saw_io_error = events
        .iter()
        .any(|e| matches!(e, JobEvent::ItemError { code, .. } if code == "io"));
    assert!(
        saw_io_error,
        "expected an io ItemError for the missing source, got {events:?}"
    );
}

#[tokio::test]
async fn tiny_garbage_file_is_rejected_as_a_stub_and_not_inserted() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    // 100 bytes of garbage, well under STUB_MAX_BYTES — a real photo/video
    // decoder must fail on it, and the file must be rejected as a stub.
    std::fs::write(drive_dir.path().join("tiny.jpg"), vec![0xAAu8; 100]).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Stub Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![src], deps, no_index()));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 0, "events: {events:?}");
    assert_eq!(failed, 0, "events: {events:?}");
    assert_eq!(skipped, 1, "events: {events:?}");

    assert_eq!(
        catalog.count_media(None).await.unwrap(),
        0,
        "a stub must never be upserted"
    );

    let saw_stub_error = events.iter().any(
        |e| matches!(e, JobEvent::ItemError { path, code, .. } if path.ends_with("tiny.jpg") && code == "stub"),
    );
    assert!(
        saw_stub_error,
        "expected an ItemError{{code: \"stub\"}} for tiny.jpg, got {events:?}"
    );
}

#[tokio::test]
async fn walk_progress_events_precede_the_first_per_file_progress() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("sample.jpg")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Walk Progress Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![src], deps, no_index()));
    runner.spawn(job_id, job);

    let (events, _terminal) = drain_until_terminal(&mut rx).await;

    let is_walk_progress = |e: &JobEvent| {
        matches!(
            e,
            JobEvent::Progress { done: 0, total: 0, current: Some(c), .. } if c.starts_with("Scanning")
        )
    };
    let is_real_progress = |e: &JobEvent| matches!(e, JobEvent::Progress { total, .. } if *total > 0);

    let walk_progress_index = events.iter().position(is_walk_progress);
    let real_progress_index = events.iter().position(is_real_progress);

    assert!(
        walk_progress_index.is_some(),
        "expected at least one walk-progress event (total==0, current starting \"Scanning\"), got {events:?}"
    );
    assert!(
        real_progress_index.is_some(),
        "expected at least one real per-file progress event, got {events:?}"
    );
    assert!(
        walk_progress_index.unwrap() < real_progress_index.unwrap(),
        "expected the walk-progress event to precede the first real progress event, got {events:?}"
    );
}

/// Task 4a.4: a scan imports an existing XMP sidecar's subjects as catalog
/// tags. `tag_media` itself marks a fresh link as a real tag-set change
/// (Task 4a.1) — pending, same as any other tag change — but a first scan
/// of a file that arrives with a sidecar should *not* leave the row
/// pending: the sidecar already holds exactly what was just imported, so
/// there's nothing for the sync job to write back. `import_sidecar_tags`
/// achieves this by comparing the row's full tag set against the imported
/// subjects right after the `tag_media` call and clearing pending when
/// they match.
#[tokio::test]
async fn scan_imports_sidecar_subjects_as_tags() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(drive_dir.path().join("Pictures")).unwrap();
    let media_path = drive_dir.path().join("Pictures/a.jpg");
    std::fs::copy(fx("sample.jpg"), &media_path).unwrap();

    let sidecars = ExiftoolSidecars::from_path();
    sidecars
        .write_subjects(&media_path, &["holiday".to_string()])
        .await
        .unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Sidecar Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(
        job_id.clone(),
        drive.clone(),
        vec![src],
        deps,
        no_index(),
    ));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    match terminal {
        JobEvent::Finished { ok, failed, .. } => {
            assert_eq!(ok, 1, "events: {events:?}");
            assert_eq!(failed, 0, "events: {events:?}");
        }
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    }

    let rows = catalog.list_media(10, 0).await.unwrap();
    assert_eq!(rows.len(), 1, "rows: {rows:?}");
    let media_id = rows[0].id;

    let tags = catalog.tags_for_media(&[media_id]).await.unwrap();
    let tag_names: Vec<&str> = tags.iter().map(|(_, t)| t.name.as_str()).collect();
    assert_eq!(tag_names, vec!["holiday"], "tags: {tags:?}");

    let pending = catalog.list_sidecar_pending(drive.id).await.unwrap();
    assert!(
        !pending.iter().any(|m| m.id == media_id),
        "a first scan whose imported tags exactly match the sidecar must not leave the row pending, got {pending:?}"
    );
}

/// When a media row already carries a catalog tag beyond what its sidecar
/// holds, importing the sidecar's subjects must still leave the row
/// sidecar-pending: the catalog's tag set (the union) no longer matches
/// the sidecar's content, so the sync job needs to write it back.
#[tokio::test]
async fn scan_leaves_row_pending_when_catalog_has_a_tag_the_sidecar_lacks() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    let media_path = drive_dir.path().join("extra.jpg");
    std::fs::copy(fx("sample.jpg"), &media_path).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Extra Tag Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    // Seed the row at the exact (drive_id, rel_path) the scan will upsert
    // into, so the scan updates this same row (and its tags survive)
    // rather than creating a new one — `upsert_media` never touches tags.
    let media_id = catalog
        .upsert_media(NewMedia {
            drive_id: drive.id,
            rel_path: "extra.jpg".into(),
            hash: "seed-hash".into(),
            size: 1,
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
            mtime: None,
            source_id: Some(src.id),
        })
        .await
        .unwrap();
    catalog
        .tag_media(&[media_id], &["extra".to_string()], &[])
        .await
        .unwrap();
    // Isolate the assertion below to the sidecar-import step: without
    // this, the pending flag set by seeding the "extra" tag above would
    // make the post-scan assertion trivially true for the wrong reason.
    catalog.clear_sidecar_pending(media_id).await.unwrap();

    let sidecars = ExiftoolSidecars::from_path();
    sidecars
        .write_subjects(&media_path, &["holiday".to_string()])
        .await
        .unwrap();

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(
        job_id.clone(),
        drive.clone(),
        vec![src],
        deps,
        no_index(),
    ));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    match terminal {
        JobEvent::Finished { ok, failed, .. } => {
            assert_eq!(ok, 1, "events: {events:?}");
            assert_eq!(failed, 0, "events: {events:?}");
        }
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    }

    let tags = catalog.tags_for_media(&[media_id]).await.unwrap();
    let mut tag_names: Vec<&str> = tags.iter().map(|(_, t)| t.name.as_str()).collect();
    tag_names.sort_unstable();
    assert_eq!(
        tag_names,
        vec!["extra", "holiday"],
        "the sidecar import must union with, not replace, the existing catalog tag; tags: {tags:?}"
    );

    let pending = catalog.list_sidecar_pending(drive.id).await.unwrap();
    assert!(
        pending.iter().any(|m| m.id == media_id),
        "the catalog's tag set (union) no longer matches the sidecar, so the row must stay pending, got {pending:?}"
    );
}

/// A sidecar read failure (here: `exiftool` itself can't be run) must not
/// fail the media file it belongs to: the file is still scanned and
/// cataloged, and the sidecar failure is recorded as a normal item error
/// instead. `exiftool` is in practice lenient about malformed XMP content
/// (still exits 0, just reports no subjects), so the read failure is
/// induced at the process level instead — the same `DpError::Sidecar`
/// path a genuinely broken `exiftool` install would hit.
#[tokio::test]
async fn scan_records_error_for_corrupt_sidecar_but_still_scans_the_file() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    let media_path = drive_dir.path().join("b.jpg");
    std::fs::copy(fx("sample.jpg"), &media_path).unwrap();
    // Only needs to exist — `read_subjects` checks existence via a plain
    // filesystem stat before ever invoking `exiftool`, so its content
    // doesn't matter for reaching the induced binary-not-found failure
    // below.
    std::fs::write(drive_dir.path().join("b.jpg.xmp"), b"placeholder").unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Corrupt Sidecar Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let mut deps = default_deps(catalog.clone(), store);
    // Swap in a binary that can't be found, so `read_subjects` fails with
    // `DpError::Sidecar` for this file's (existing) sidecar.
    deps.sidecars = Arc::new(ExiftoolSidecars::new("dp-test-nonexistent-exiftool-binary"));

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![src], deps, no_index()));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    match terminal {
        JobEvent::Finished { ok, failed, .. } => {
            assert_eq!(ok, 1, "the media file must still be scanned, events: {events:?}");
            assert_eq!(
                failed, 0,
                "a sidecar read failure must never fail the file itself, events: {events:?}"
            );
        }
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    }

    assert_eq!(catalog.count_media(None).await.unwrap(), 1);

    let saw_sidecar_error = events.iter().any(|e| {
        matches!(e, JobEvent::ItemError { path, code, .. } if path.ends_with("b.jpg") && code == "sidecar")
    });
    assert!(
        saw_sidecar_error,
        "expected an ItemError{{code: \"sidecar\"}} for the corrupt sidecar, got {events:?}"
    );
}

/// `.xmp` sidecar files themselves must never be indexed as media — the
/// extension filter in `collect_media_files` (via `MediaKind::from_ext`)
/// already excludes them; this proves it end-to-end.
#[tokio::test]
async fn xmp_sidecar_files_are_never_indexed_as_media() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    let media_path = drive_dir.path().join("c.jpg");
    std::fs::copy(fx("sample.jpg"), &media_path).unwrap();

    let sidecars = ExiftoolSidecars::from_path();
    sidecars
        .write_subjects(&media_path, &["beach".to_string()])
        .await
        .unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Xmp Not Media Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));
    let deps = default_deps(catalog.clone(), store);

    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![src], deps, no_index()));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    match terminal {
        JobEvent::Finished { ok, .. } => {
            assert_eq!(
                ok, 1,
                "only c.jpg must be indexed, not its .xmp sidecar, events: {events:?}"
            );
        }
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    }

    assert_eq!(catalog.count_media(None).await.unwrap(), 1);
    let rows = catalog.list_media(10, 0).await.unwrap();
    assert!(
        rows.iter().all(|r| !r.rel_path.ends_with(".xmp")),
        "no row's rel_path should end in .xmp, got {rows:?}"
    );
    assert_eq!(rows[0].rel_path, "c.jpg");
}

// --- Task 5a.2: incremental rescan ------------------------------------
//
// A drive whose files haven't changed since the last scan should skip
// hashing, exiftool, and thumbnailing entirely for those files — see
// `find_skip_match` in `dp_jobs::scan`. Every test below runs an initial
// full scan (empty skip index) to populate the catalog and thumbnails,
// then a second scan built from `list_scan_index`'s real fingerprint,
// asserting on what that second scan did or didn't touch.

/// The base case: nothing on disk changed between two scans of the same
/// drive, so the second scan must skip every file without ever calling
/// the hasher — proven with [`CountingHasher`], not just by asserting the
/// tallies (a bug that skipped the *catalog* work but still hashed would
/// otherwise pass).
#[tokio::test]
async fn second_scan_of_unchanged_fixtures_skips_everything_without_hashing() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("sample.jpg")).unwrap();
    std::fs::copy(fx("sample.png"), drive_dir.path().join("sample.png")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Incremental Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));

    let (_events, terminal) = run_scan(
        drive.clone(),
        vec![src.clone()],
        default_deps(catalog.clone(), store.clone()),
        no_index(),
    )
    .await;
    match terminal {
        JobEvent::Finished { ok, .. } => assert_eq!(ok, 2),
        other => panic!("expected Finished, got {other:?}"),
    }

    let hash_calls = Arc::new(AtomicU64::new(0));
    let mut deps = default_deps(catalog.clone(), store.clone());
    deps.hasher = Arc::new(CountingHasher {
        calls: hash_calls.clone(),
    });
    let index = scan_index(&catalog, drive.id).await;

    let (events, terminal) = run_scan(drive, vec![src], deps, index).await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 0, "events: {events:?}");
    assert_eq!(failed, 0, "events: {events:?}");
    assert_eq!(skipped, 2, "events: {events:?}");
    assert_eq!(
        hash_calls.load(Ordering::SeqCst),
        0,
        "an unchanged file must never reach the hasher"
    );
}

/// Touching just one file's mtime (rewriting it with identical bytes, so
/// only its mtime moves) must cause exactly that file to be reprocessed —
/// the other, truly-unchanged file must still be skipped.
#[tokio::test]
async fn touching_one_files_mtime_reprocesses_only_that_file() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    let jpg_path = drive_dir.path().join("sample.jpg");
    std::fs::copy(fx("sample.jpg"), &jpg_path).unwrap();
    std::fs::copy(fx("sample.png"), drive_dir.path().join("sample.png")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Touch Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));

    let (_events, terminal) = run_scan(
        drive.clone(),
        vec![src.clone()],
        default_deps(catalog.clone(), store.clone()),
        no_index(),
    )
    .await;
    match terminal {
        JobEvent::Finished { ok, .. } => assert_eq!(ok, 2),
        other => panic!("expected Finished, got {other:?}"),
    }

    // The skip rule compares mtime at second precision, so the rewrite
    // below needs to land in a different wall-clock second than the
    // first scan's stat to register as a change.
    tokio::time::sleep(Duration::from_millis(1100)).await;
    std::fs::write(&jpg_path, std::fs::read(fx("sample.jpg")).unwrap()).unwrap();

    let index = scan_index(&catalog, drive.id).await;
    let (events, terminal) = run_scan(drive, vec![src], default_deps(catalog.clone(), store), index).await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(
        ok, 1,
        "only the touched file should be reprocessed, events: {events:?}"
    );
    assert_eq!(failed, 0, "events: {events:?}");
    assert_eq!(
        skipped, 1,
        "the untouched file should still be skipped, events: {events:?}"
    );
}

/// A missing thumbnail file (e.g. the thumbs directory got partially
/// cleaned up) must force reprocessing even though size/mtime still
/// match — the skip rule requires both thumbnail sizes to exist on disk.
#[tokio::test]
async fn missing_thumbnail_forces_reprocessing() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("sample.jpg")).unwrap();
    std::fs::copy(fx("sample.png"), drive_dir.path().join("sample.png")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Missing Thumb Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));

    let (_events, terminal) = run_scan(
        drive.clone(),
        vec![src.clone()],
        default_deps(catalog.clone(), store.clone()),
        no_index(),
    )
    .await;
    match terminal {
        JobEvent::Finished { ok, .. } => assert_eq!(ok, 2),
        other => panic!("expected Finished, got {other:?}"),
    }

    let jpg_hash = Blake3Hasher.hash_file(&fx("sample.jpg")).await.unwrap();
    std::fs::remove_file(store.path(&jpg_hash, 400)).unwrap();

    let index = scan_index(&catalog, drive.id).await;
    let (events, terminal) = run_scan(
        drive,
        vec![src],
        default_deps(catalog.clone(), store.clone()),
        index,
    )
    .await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(
        ok, 1,
        "the file missing a thumbnail must be reprocessed, events: {events:?}"
    );
    assert_eq!(failed, 0, "events: {events:?}");
    assert_eq!(skipped, 1, "events: {events:?}");
    assert!(
        store.exists(&jpg_hash, 400),
        "the missing thumbnail must be regenerated"
    );
}

/// A skipped file's sidecar may still have been edited since the last
/// scan (e.g. in Lightroom) — the skip rule must still import its
/// subjects as tags, without re-hashing the file itself.
#[tokio::test]
async fn sidecar_newer_than_row_mtime_imports_tags_on_a_skipped_file() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    let media_path = drive_dir.path().join("a.jpg");
    std::fs::copy(fx("sample.jpg"), &media_path).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Sidecar Skip Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));

    let (events, terminal) = run_scan(
        drive.clone(),
        vec![src.clone()],
        default_deps(catalog.clone(), store.clone()),
        no_index(),
    )
    .await;
    match terminal {
        JobEvent::Finished { ok, .. } => assert_eq!(ok, 1, "events: {events:?}"),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    }

    let rows = catalog.list_media(10, 0).await.unwrap();
    assert_eq!(rows.len(), 1, "rows: {rows:?}");
    let media_id = rows[0].id;

    // Write the sidecar strictly after the row's stored mtime.
    tokio::time::sleep(Duration::from_millis(1100)).await;
    let sidecars = ExiftoolSidecars::from_path();
    sidecars
        .write_subjects(&media_path, &["beach".to_string()])
        .await
        .unwrap();

    let hash_calls = Arc::new(AtomicU64::new(0));
    let mut deps = default_deps(catalog.clone(), store.clone());
    deps.hasher = Arc::new(CountingHasher {
        calls: hash_calls.clone(),
    });
    let index = scan_index(&catalog, drive.id).await;

    let (events, terminal) = run_scan(drive, vec![src], deps, index).await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 0, "events: {events:?}");
    assert_eq!(failed, 0, "events: {events:?}");
    assert_eq!(skipped, 1, "events: {events:?}");
    assert_eq!(
        hash_calls.load(Ordering::SeqCst),
        0,
        "importing a newer sidecar on a skipped file must not re-hash it"
    );

    let tags = catalog.tags_for_media(&[media_id]).await.unwrap();
    let tag_names: Vec<&str> = tags.iter().map(|(_, t)| t.name.as_str()).collect();
    assert_eq!(tag_names, vec!["beach"], "tags: {tags:?}");
}

/// `full: true` at the command layer bypasses the skip index entirely —
/// simulated here the same way the command builds it (an empty map) — so
/// a rescan with nothing changed on disk must still reprocess every file.
#[tokio::test]
async fn full_rescan_bypasses_the_skip_index_and_reprocesses_everything() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("sample.jpg")).unwrap();
    std::fs::copy(fx("sample.png"), drive_dir.path().join("sample.png")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Full Rescan Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));

    let (_events, terminal) = run_scan(
        drive.clone(),
        vec![src.clone()],
        default_deps(catalog.clone(), store.clone()),
        no_index(),
    )
    .await;
    match terminal {
        JobEvent::Finished { ok, .. } => assert_eq!(ok, 2),
        other => panic!("expected Finished, got {other:?}"),
    }

    // The real skip index would let both files skip — passing an empty
    // map instead (what `full: true` does at the command layer) must
    // force full reprocessing regardless.
    let hash_calls = Arc::new(AtomicU64::new(0));
    let mut deps = default_deps(catalog.clone(), store.clone());
    deps.hasher = Arc::new(CountingHasher {
        calls: hash_calls.clone(),
    });

    let (events, terminal) = run_scan(drive, vec![src], deps, no_index()).await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 2, "events: {events:?}");
    assert_eq!(failed, 0, "events: {events:?}");
    assert_eq!(skipped, 0, "events: {events:?}");
    assert_eq!(
        hash_calls.load(Ordering::SeqCst),
        2,
        "every file must be re-hashed under a full rescan"
    );
}

// --- Fix round 1: skipped visible, sidecar convergence, source unfreeze --

/// A stored `mtime` of `NULL` (a pre-migration row, or one written before
/// the incremental-rescan feature existed) must never be trusted as
/// "unknown but fine" — the skip rule requires an actual stored mtime to
/// compare against (see `find_skip_match`), so such a row is always
/// reprocessed once, which backfills a real mtime for every scan after.
#[tokio::test]
async fn null_stored_mtime_forces_reprocessing_and_backfills_it() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    std::fs::copy(fx("sample.jpg"), drive_dir.path().join("sample.jpg")).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Null Mtime Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));

    let (_events, terminal) = run_scan(
        drive.clone(),
        vec![src.clone()],
        default_deps(catalog.clone(), store.clone()),
        no_index(),
    )
    .await;
    match terminal {
        JobEvent::Finished { ok, .. } => assert_eq!(ok, 1),
        other => panic!("expected Finished, got {other:?}"),
    }

    let rows = catalog.list_media(10, 0).await.unwrap();
    assert_eq!(rows.len(), 1, "rows: {rows:?}");
    assert!(
        rows[0].mtime.is_some(),
        "the first scan must have written a real mtime"
    );

    // Simulate a row that predates the mtime column: null it back out
    // directly, bypassing the scan pipeline entirely.
    catalog.upsert_media(null_out_mtime(&rows[0])).await.unwrap();

    let index = scan_index(&catalog, drive.id).await;
    let (events, terminal) = run_scan(drive, vec![src], default_deps(catalog.clone(), store), index).await;
    let (ok, skipped) = match terminal {
        JobEvent::Finished { ok, skipped, .. } => (ok, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(
        ok, 1,
        "a null stored mtime must force reprocessing, events: {events:?}"
    );
    assert_eq!(skipped, 0, "events: {events:?}");

    let rows = catalog.list_media(10, 0).await.unwrap();
    assert!(
        rows[0].mtime.is_some(),
        "reprocessing must backfill a real mtime, got {rows:?}"
    );
}

/// The skip rule's `size` check must catch a change even when `mtime`
/// happens to still match — proven by rewriting the file with different
/// (larger) content, then forcing its mtime back to the original value
/// with `touch`, isolating this from the mtime-touch test above (which
/// changes mtime while size stays the same).
#[tokio::test]
async fn size_changed_with_mtime_forced_equal_still_reprocesses() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    let jpg_path = drive_dir.path().join("sample.jpg");
    std::fs::copy(fx("sample.jpg"), &jpg_path).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Size Change Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));

    let (_events, terminal) = run_scan(
        drive.clone(),
        vec![src.clone()],
        default_deps(catalog.clone(), store.clone()),
        no_index(),
    )
    .await;
    match terminal {
        JobEvent::Finished { ok, .. } => assert_eq!(ok, 1),
        other => panic!("expected Finished, got {other:?}"),
    }

    let original_mtime = std::fs::metadata(&jpg_path).unwrap().modified().unwrap();

    // Trailing bytes past a JPEG's EOI marker are ignored by decoders, so
    // this changes the file's size without breaking thumbnail rendering
    // or metadata reading.
    let mut bytes = std::fs::read(fx("sample.jpg")).unwrap();
    bytes.extend_from_slice(b"-size-change-padding-bytes-");
    std::fs::write(&jpg_path, &bytes).unwrap();
    force_mtime_to_match(&jpg_path, original_mtime);

    let touched: chrono::DateTime<chrono::Utc> =
        std::fs::metadata(&jpg_path).unwrap().modified().unwrap().into();
    let original: chrono::DateTime<chrono::Utc> = original_mtime.into();
    assert_eq!(
        touched.timestamp(),
        original.timestamp(),
        "the touch trick must leave mtime (at second precision) unchanged, so this test isolates the size check"
    );

    let index = scan_index(&catalog, drive.id).await;
    let (events, terminal) = run_scan(drive, vec![src], default_deps(catalog.clone(), store), index).await;
    let (ok, skipped) = match terminal {
        JobEvent::Finished { ok, skipped, .. } => (ok, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(
        ok, 1,
        "a size change must force reprocessing even with mtime unchanged, events: {events:?}"
    );
    assert_eq!(skipped, 0, "events: {events:?}");
}

/// A row whose `source_id` is `NULL` (scanned before sources existed) —
/// even with matching size/mtime/thumbnails — must never be skipped: the
/// skip rule refuses a null or differing source (see `find_skip_match`),
/// so re-scanning a legacy drive is what finally attributes those rows to
/// a real source.
#[tokio::test]
async fn source_id_null_forces_reprocessing_and_backfills_the_source() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    let jpg_path = drive_dir.path().join("sample.jpg");
    std::fs::copy(fx("sample.jpg"), &jpg_path).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Legacy Source Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));

    // Manually seed a "legacy" row — real size/mtime/hash for the file on
    // disk, thumbnails already present at that hash, but `source_id:
    // None` — without ever running a real scan, so nothing else could
    // have attributed it to a source.
    let meta = std::fs::symlink_metadata(&jpg_path).unwrap();
    let size = meta.len();
    let mtime: chrono::DateTime<chrono::Utc> = meta.modified().unwrap().into();
    let hash = Blake3Hasher.hash_file(&jpg_path).await.unwrap();
    for size_px in [400u32, 2000u32] {
        let thumb_path = store.path(&hash, size_px);
        std::fs::create_dir_all(thumb_path.parent().unwrap()).unwrap();
        std::fs::write(&thumb_path, b"fake-thumb-bytes").unwrap();
    }
    catalog
        .upsert_media(NewMedia {
            drive_id: drive.id,
            rel_path: "sample.jpg".into(),
            hash,
            size,
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
            mtime: Some(mtime),
        })
        .await
        .unwrap();

    let index = scan_index(&catalog, drive.id).await;
    let (events, terminal) = run_scan(
        drive.clone(),
        vec![src.clone()],
        default_deps(catalog.clone(), store),
        index,
    )
    .await;
    let (ok, skipped) = match terminal {
        JobEvent::Finished { ok, skipped, .. } => (ok, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(
        ok, 1,
        "a source-less row must be reprocessed even though everything else matches, events: {events:?}"
    );
    assert_eq!(skipped, 0, "events: {events:?}");

    let rows = catalog.list_media(10, 0).await.unwrap();
    assert_eq!(rows.len(), 1, "rows: {rows:?}");
    assert_eq!(
        rows[0].source_id,
        Some(src.id),
        "reprocessing must attribute the row to the real source, got {rows:?}"
    );
}

/// After a normal first scan imports a sidecar's subjects (the
/// full-processing path, which now also records the sidecar's mtime), a
/// second incremental scan of the same unchanged drive must skip the
/// file *and* never call `Sidecars::read_subjects` again — proven with
/// [`CountingSidecars`]. Before recording that baseline, the sidecar
/// would have looked newer than the row's stored (file) mtime forever,
/// re-reading it via exiftool on every single rescan.
#[tokio::test]
async fn second_incremental_scan_after_an_import_reads_the_sidecar_zero_times() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    let media_path = drive_dir.path().join("a.jpg");
    std::fs::copy(fx("sample.jpg"), &media_path).unwrap();

    let sidecars = ExiftoolSidecars::from_path();
    sidecars
        .write_subjects(&media_path, &["beach".to_string()])
        .await
        .unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Converge After Import Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));

    let (events, terminal) = run_scan(
        drive.clone(),
        vec![src.clone()],
        default_deps(catalog.clone(), store.clone()),
        no_index(),
    )
    .await;
    match terminal {
        JobEvent::Finished { ok, .. } => assert_eq!(ok, 1, "events: {events:?}"),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    }

    let rows = catalog.list_media(10, 0).await.unwrap();
    assert_eq!(rows.len(), 1, "rows: {rows:?}");
    let media_id = rows[0].id;
    let tags = catalog.tags_for_media(&[media_id]).await.unwrap();
    let tag_names: Vec<&str> = tags.iter().map(|(_, t)| t.name.as_str()).collect();
    assert_eq!(tag_names, vec!["beach"], "tags: {tags:?}");

    let reads = Arc::new(AtomicU64::new(0));
    let mut deps = default_deps(catalog.clone(), store);
    deps.sidecars = Arc::new(CountingSidecars { reads: reads.clone() });
    let index = scan_index(&catalog, drive.id).await;

    let (events, terminal) = run_scan(drive, vec![src], deps, index).await;
    let (ok, skipped) = match terminal {
        JobEvent::Finished { ok, skipped, .. } => (ok, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 0, "events: {events:?}");
    assert_eq!(skipped, 1, "events: {events:?}");
    assert_eq!(
        reads.load(Ordering::SeqCst),
        0,
        "a sidecar unchanged since the recorded baseline must never be re-read"
    );
}

/// A sidecar written *after* the last scan (no baseline recorded yet, so
/// the fallback is the row's file mtime) must be imported exactly once —
/// and because that import records a fresh baseline, a third scan of the
/// same still-unchanged sidecar must read it zero further times.
#[tokio::test]
async fn sidecar_newer_than_recorded_baseline_reimports_once_then_converges() {
    if !has_exiftool() {
        eprintln!("skipping: exiftool not installed");
        return;
    }

    let drive_dir = tempfile::tempdir().unwrap();
    let media_path = drive_dir.path().join("a.jpg");
    std::fs::copy(fx("sample.jpg"), &media_path).unwrap();

    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive = register_drive(&catalog, "Converge After Newer Sidecar Drive", drive_dir.path()).await;
    let src = root_source(&catalog, drive.id).await;

    let thumbs_dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(thumbs_dir.path()));

    // First scan: no sidecar yet, so no baseline gets recorded — the
    // next scan's comparison falls back to the row's file mtime.
    let (_events, terminal) = run_scan(
        drive.clone(),
        vec![src.clone()],
        default_deps(catalog.clone(), store.clone()),
        no_index(),
    )
    .await;
    match terminal {
        JobEvent::Finished { ok, .. } => assert_eq!(ok, 1),
        other => panic!("expected Finished, got {other:?}"),
    }

    tokio::time::sleep(Duration::from_millis(1100)).await;
    let sidecars = ExiftoolSidecars::from_path();
    sidecars
        .write_subjects(&media_path, &["beach".to_string()])
        .await
        .unwrap();

    // Second scan: the sidecar is genuinely newer than the fallback
    // baseline (the file's mtime, from before the sleep) — must import
    // exactly once.
    let reads = Arc::new(AtomicU64::new(0));
    let mut deps = default_deps(catalog.clone(), store.clone());
    deps.sidecars = Arc::new(CountingSidecars { reads: reads.clone() });
    let index = scan_index(&catalog, drive.id).await;

    let (events, terminal) = run_scan(drive.clone(), vec![src.clone()], deps, index).await;
    let (ok, skipped) = match terminal {
        JobEvent::Finished { ok, skipped, .. } => (ok, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 0, "events: {events:?}");
    assert_eq!(skipped, 1, "events: {events:?}");
    assert_eq!(
        reads.load(Ordering::SeqCst),
        1,
        "the newer sidecar must be read exactly once"
    );

    let rows = catalog.list_media(10, 0).await.unwrap();
    let media_id = rows[0].id;
    let tags = catalog.tags_for_media(&[media_id]).await.unwrap();
    let tag_names: Vec<&str> = tags.iter().map(|(_, t)| t.name.as_str()).collect();
    assert_eq!(tag_names, vec!["beach"], "tags: {tags:?}");

    // Third scan: the sidecar hasn't changed since the second scan
    // recorded its mtime as the new baseline — must read it zero more
    // times (same shared counter — the total must still be 1).
    let mut deps = default_deps(catalog.clone(), store);
    deps.sidecars = Arc::new(CountingSidecars { reads: reads.clone() });
    let index = scan_index(&catalog, drive.id).await;

    let (events, terminal) = run_scan(drive, vec![src], deps, index).await;
    match terminal {
        JobEvent::Finished { ok, skipped, .. } => {
            assert_eq!(ok, 0, "events: {events:?}");
            assert_eq!(skipped, 1, "events: {events:?}");
        }
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    }
    assert_eq!(
        reads.load(Ordering::SeqCst),
        1,
        "the sidecar must converge: no further reads once its mtime has been recorded"
    );
}
