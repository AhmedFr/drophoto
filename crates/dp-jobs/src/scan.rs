use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use dp_catalog::Catalog;
use dp_core::{DpError, DpResult, Drive, MediaKind, MediaMetadata, NewMedia};
use dp_hash::Hasher;
use dp_metadata::MetadataProvider;
use dp_thumbs::{ThumbChain, ThumbStore, THUMB_SIZES};
use futures::stream::{self, StreamExt};
use walkdir::{DirEntry, WalkDir};

use crate::{error_code, Job, JobCtx, JobEvent, JobOutcome};

/// Number of files hashed/thumbnailed/read concurrently during a scan.
const SCAN_CONCURRENCY: usize = 4;

/// External dependencies a [`ScanJob`] needs, injected so tests can swap in
/// fakes/in-memory implementations.
pub struct ScanDeps {
    pub catalog: Arc<dyn Catalog>,
    pub hasher: Arc<dyn Hasher>,
    pub metadata: Arc<dyn MetadataProvider>,
    pub thumbs: Arc<ThumbChain>,
    pub store: Arc<ThumbStore>,
}

/// A [`Job`] that walks a drive's mount path, hashing, thumbnailing, and
/// reading metadata for every media file found, then upserting it into the
/// catalog.
pub struct ScanJob {
    id: String,
    drive: Drive,
    deps: ScanDeps,
}

impl ScanJob {
    pub fn new(id: String, drive: Drive, deps: ScanDeps) -> Self {
        Self { id, drive, deps }
    }
}

#[async_trait]
impl Job for ScanJob {
    fn id(&self) -> &str {
        &self.id
    }

    async fn run(&self, ctx: JobCtx) -> DpResult<JobOutcome> {
        let mount_path = self.drive.mount_path.clone().ok_or_else(|| DpError::NotFound {
            message: "drive is offline".into(),
        })?;

        let files = collect_media_files(Path::new(&mount_path));
        let total = files.len() as u64;

        let done = AtomicU64::new(0);
        let ok = AtomicU64::new(0);
        let failed = AtomicU64::new(0);

        stream::iter(files)
            .for_each_concurrent(SCAN_CONCURRENCY, |file| {
                let ctx = ctx.clone();
                let mount_path = mount_path.clone();
                let done = &done;
                let ok = &ok;
                let failed = &failed;
                async move {
                    process_file(&ctx, self, &mount_path, file, total, done, ok, failed).await;
                }
            })
            .await;

        Ok(JobOutcome {
            ok: ok.load(Ordering::SeqCst),
            failed: failed.load(Ordering::SeqCst),
            skipped: 0,
            cancelled: ctx.cancel.is_cancelled(),
        })
    }
}

/// A media file discovered during the walk, with its `MediaKind` and
/// canonical (lowercase) extension already resolved.
struct ScannedFile {
    path: PathBuf,
    ext: &'static str,
    kind: MediaKind,
}

/// Whether `entry`'s name starts with `.`. This covers ordinary dotfiles
/// as well as macOS/APFS housekeeping directories such as `.Trashes`,
/// `.Spotlight-V100`, and `.fseventsd`, all of which are dot-prefixed.
fn is_hidden(entry: &DirEntry) -> bool {
    entry.file_name().to_string_lossy().starts_with('.')
}

/// Walks `root`, skipping hidden entries and known housekeeping
/// directories, returning every file whose extension maps to a
/// [`MediaKind`].
fn collect_media_files(root: &Path) -> Vec<ScannedFile> {
    WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| e.depth() == 0 || !is_hidden(e))
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let ext = e.path().extension()?.to_str()?;
            let (kind, canonical_ext) = MediaKind::from_ext(ext)?;
            Some(ScannedFile {
                path: e.into_path(),
                ext: canonical_ext,
                kind,
            })
        })
        .collect()
}

/// Path of `path` relative to `mount_path`, using forward slashes.
fn rel_path(path: &Path, mount_path: &str) -> String {
    path.strip_prefix(Path::new(mount_path))
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

#[allow(clippy::too_many_arguments)]
async fn process_file(
    ctx: &JobCtx,
    job: &ScanJob,
    mount_path: &str,
    file: ScannedFile,
    total: u64,
    done: &AtomicU64,
    ok: &AtomicU64,
    failed: &AtomicU64,
) {
    if ctx.cancel.is_cancelled() {
        return;
    }

    let deps = &job.deps;
    let drive_id = job.drive.id;
    let job_id = job.id();
    let rel = rel_path(&file.path, mount_path);
    let mut had_error = false;

    let size = tokio::fs::metadata(&file.path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    let hash = match deps.hasher.hash_file(&file.path).await {
        Ok(h) => h,
        Err(e) => {
            report_item_error(ctx, deps, job_id, drive_id, &rel, &e).await;
            failed.fetch_add(1, Ordering::SeqCst);
            advance_progress(ctx, job_id, done, total, &rel).await;
            return;
        }
    };

    for size_px in THUMB_SIZES {
        if deps.store.exists(&hash, size_px) {
            continue;
        }
        let render_result = deps.thumbs.render(&file.path, file.ext, size_px).await;
        match render_result {
            Ok(img) => {
                if let Err(e) = deps.store.write(&hash, size_px, &img).await {
                    had_error = true;
                    report_item_error(ctx, deps, job_id, drive_id, &rel, &e).await;
                }
            }
            Err(e) => {
                had_error = true;
                report_item_error(ctx, deps, job_id, drive_id, &rel, &e).await;
            }
        }
    }

    let metadata = match deps.metadata.read(&file.path).await {
        Ok(m) => m,
        Err(e) => {
            had_error = true;
            report_item_error(ctx, deps, job_id, drive_id, &rel, &e).await;
            MediaMetadata::default()
        }
    };

    let new_media = NewMedia {
        drive_id,
        rel_path: rel.clone(),
        hash,
        size,
        kind: file.kind,
        ext: file.ext.to_string(),
        width: metadata.width,
        height: metadata.height,
        duration_ms: metadata.duration_ms,
        taken_at: metadata.taken_at,
        camera: metadata.camera,
        lens: metadata.lens,
        aperture: metadata.aperture,
        shutter: metadata.shutter,
        iso: metadata.iso,
        focal_mm: metadata.focal_mm,
        lat: metadata.lat,
        lon: metadata.lon,
    };

    if let Err(e) = deps.catalog.upsert_media(new_media).await {
        had_error = true;
        report_item_error(ctx, deps, job_id, drive_id, &rel, &e).await;
    }

    if had_error {
        failed.fetch_add(1, Ordering::SeqCst);
    } else {
        ok.fetch_add(1, Ordering::SeqCst);
    }

    advance_progress(ctx, job_id, done, total, &rel).await;
}

async fn advance_progress(ctx: &JobCtx, job_id: &str, done: &AtomicU64, total: u64, current: &str) {
    let d = done.fetch_add(1, Ordering::SeqCst) + 1;
    let _ = ctx
        .events
        .send(JobEvent::Progress {
            job_id: job_id.to_string(),
            done: d,
            total,
            current: Some(current.to_string()),
        })
        .await;
}

async fn report_item_error(
    ctx: &JobCtx,
    deps: &ScanDeps,
    job_id: &str,
    drive_id: i64,
    path: &str,
    e: &DpError,
) {
    let code = error_code(e);
    let message = e.to_string();
    let _ = ctx
        .events
        .send(JobEvent::ItemError {
            job_id: job_id.to_string(),
            path: path.to_string(),
            code: code.to_string(),
            message: message.clone(),
        })
        .await;
    let _ = deps
        .catalog
        .record_scan_error(drive_id, path, code, &message)
        .await;
}
