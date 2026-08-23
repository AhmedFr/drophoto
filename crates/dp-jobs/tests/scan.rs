use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{Drive, DriveRole, MediaKind, NewDrive, NewMedia, NewSource, Source};
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
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![src], deps));
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
    let job = Arc::new(ScanJob::new(job_id.clone(), drive.clone(), vec![src], deps));
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
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![src], deps));
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

    let job = ScanJob::new("scan-direct-precancel".into(), drive, vec![src], deps);

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

    let job = ScanJob::new("scan-direct-live".into(), drive, vec![src], deps);

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
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![src], deps));
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
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![dcim], deps));
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
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![upper, lower], deps));
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
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![dcim, link], deps));
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
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![pictures, missing], deps));
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
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![src], deps));
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
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![src], deps));
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
/// tags. The first import genuinely links a new tag to the row, so
/// `tag_media` (per Task 4a.1) marks it sidecar-pending like any other
/// real tag change — the scan never calls `clear_sidecar_pending` itself,
/// leaving that to the sync job. A *second* scan, with the sidecar
/// unchanged and the row already synced (pending cleared), must leave the
/// row un-pending: `tag_media` no-ops when the tag set doesn't actually
/// change, so importing identical tags marks nothing pending.
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

    let deps = default_deps(catalog.clone(), store.clone());
    let (tx, mut rx) = mpsc::channel(256);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("scan");
    let job = Arc::new(ScanJob::new(
        job_id.clone(),
        drive.clone(),
        vec![src.clone()],
        deps,
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

    // First import is a genuine change (no prior tags) — pending is set,
    // same as any other real tag change. Simulate the sync job having
    // caught up (written the sidecar, cleared pending) before the next
    // scan.
    let pending = catalog.list_sidecar_pending(drive.id).await.unwrap();
    assert!(
        pending.iter().any(|m| m.id == media_id),
        "the first sidecar import is a real tag change and must mark the row pending, got {pending:?}"
    );
    catalog.clear_sidecar_pending(media_id).await.unwrap();

    // Re-scan with the sidecar unchanged: `tag_media` no-ops because the
    // catalog's tag set already matches, so the row must NOT be marked
    // pending again, and the scan itself never calls
    // `clear_sidecar_pending` — there's nothing here for it to clear.
    let deps2 = default_deps(catalog.clone(), store);
    let (tx2, mut rx2) = mpsc::channel(256);
    let runner2 = JobRunner::new(tx2);
    let job_id2 = runner2.next_id("scan");
    let job2 = Arc::new(ScanJob::new(job_id2.clone(), drive.clone(), vec![src], deps2));
    runner2.spawn(job_id2, job2);
    let (events2, terminal2) = drain_until_terminal(&mut rx2).await;
    match terminal2 {
        JobEvent::Finished { ok, failed, .. } => {
            assert_eq!(ok, 1, "events: {events2:?}");
            assert_eq!(failed, 0, "events: {events2:?}");
        }
        other => panic!("expected Finished, got {other:?} (events: {events2:?})"),
    }

    let pending_after_rescan = catalog.list_sidecar_pending(drive.id).await.unwrap();
    assert!(
        !pending_after_rescan.iter().any(|m| m.id == media_id),
        "re-importing identical subjects must not re-mark the row pending, got {pending_after_rescan:?}"
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
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![src], deps));
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
    let job = Arc::new(ScanJob::new(job_id.clone(), drive, vec![src], deps));
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
