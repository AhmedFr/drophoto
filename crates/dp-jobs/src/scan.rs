use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use dp_catalog::Catalog;
use dp_core::denylist::is_denied_path;
use dp_core::{DpError, DpResult, Drive, MediaKind, MediaMetadata, NewMedia, Source};
use dp_hash::Hasher;
use dp_metadata::MetadataProvider;
use dp_thumbs::{ThumbChain, ThumbStore, THUMB_SIZES};
use futures::stream::{self, StreamExt};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use walkdir::WalkDir;

use crate::{error_code, Job, JobCtx, JobEvent, JobOutcome};

/// Number of files hashed/thumbnailed/read concurrently during a scan.
const SCAN_CONCURRENCY: usize = 4;

/// Below this size (bytes), a file whose thumbnail generation fails is
/// treated as a corrupt/placeholder "stub" rather than a real media file:
/// it is never upserted into the catalog (see [`process_file`]). Larger
/// files that fail thumbnailing keep the old behaviour — upserted, with
/// the thumbnail error recorded.
const STUB_MAX_BYTES: u64 = 8192;

/// How many walked entries pass between two walk-progress events (see
/// `collect_media_files`), so a huge tree doesn't flood the event
/// channel.
const WALK_PROGRESS_INTERVAL: u64 = 200;

/// External dependencies a [`ScanJob`] needs, injected so tests can swap in
/// fakes/in-memory implementations.
pub struct ScanDeps {
    pub catalog: Arc<dyn Catalog>,
    pub hasher: Arc<dyn Hasher>,
    pub metadata: Arc<dyn MetadataProvider>,
    pub thumbs: Arc<ThumbChain>,
    pub store: Arc<ThumbStore>,
    /// The current user's home directory (`$HOME`), used for the
    /// deny-list's `home/Library` rule (see
    /// [`dp_core::denylist::is_denied_path`]). `None` when it couldn't be
    /// resolved — the command layer is expected to `tracing::warn!` in
    /// that case and pass `None` through, which simply skips that one
    /// rule rather than failing the scan.
    pub home: Option<PathBuf>,
}

/// A [`Job`] that walks each of a drive's *enabled* [`Source`]s, hashing,
/// thumbnailing, and reading metadata for every media file found, then
/// upserting it into the catalog with that source's id attached.
pub struct ScanJob {
    id: String,
    drive: Drive,
    sources: Vec<Source>,
    deps: ScanDeps,
}

impl ScanJob {
    pub fn new(id: String, drive: Drive, sources: Vec<Source>, deps: ScanDeps) -> Self {
        Self {
            id,
            drive,
            sources,
            deps,
        }
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
        let mount = std::fs::canonicalize(&mount_path).map_err(|e| DpError::Io {
            message: format!("failed to canonicalize mount path: {e}"),
            path: Some(mount_path.clone()),
        })?;

        let sources: Vec<Source> = self.sources.iter().filter(|s| s.enabled).cloned().collect();

        let walk_cancel = ctx.cancel.clone();
        let walk_home = self.deps.home.clone();
        let walk_events = ctx.events.clone();
        let walk_job_id = self.id.clone();
        let walk_mount = mount.clone();
        let walk_sources = sources.clone();
        let walk = tokio::task::spawn_blocking(move || {
            collect_media_files(
                &walk_mount,
                &walk_sources,
                walk_home.as_deref(),
                &walk_cancel,
                &walk_job_id,
                &walk_events,
            )
        })
        .await
        .map_err(|e| DpError::Io {
            message: format!("scan walk task failed: {e}"),
            path: None,
        })?;

        let done = AtomicU64::new(0);
        let ok = AtomicU64::new(0);
        let failed = AtomicU64::new(0);
        let skipped = AtomicU64::new(0);
        // Set either by the blocking walk noticing cancellation mid-walk, or
        // inside process_file's pre-file cancellation check, so it reflects
        // an actual early exit rather than the token's state at some
        // arbitrary later instant, which would race against cancellation
        // arriving right as the job finishes on its own.
        let stopped_early = AtomicBool::new(walk.stopped_early);

        let drive_id = self.drive.id;
        for (path, message) in &walk.errors {
            failed.fetch_add(1, Ordering::SeqCst);
            report_item_error_raw(&ctx, &self.deps, self.id(), drive_id, path, "io", message).await;
        }

        let total = walk.files.len() as u64;
        stream::iter(walk.files)
            .for_each_concurrent(SCAN_CONCURRENCY, |file| {
                let ctx = ctx.clone();
                let mount = mount.clone();
                let done = &done;
                let ok = &ok;
                let failed = &failed;
                let skipped = &skipped;
                let stopped_early = &stopped_early;
                async move {
                    process_file(
                        &ctx,
                        self,
                        &mount,
                        file,
                        total,
                        done,
                        ok,
                        failed,
                        skipped,
                        stopped_early,
                    )
                    .await;
                }
            })
            .await;

        Ok(JobOutcome {
            ok: ok.load(Ordering::SeqCst),
            failed: failed.load(Ordering::SeqCst),
            skipped: skipped.load(Ordering::SeqCst),
            cancelled: stopped_early.load(Ordering::SeqCst),
        })
    }
}

/// A media file discovered during the walk, with its `MediaKind`,
/// canonical (lowercase) extension, and owning source id already
/// resolved.
struct ScannedFile {
    path: PathBuf,
    ext: &'static str,
    kind: MediaKind,
    source_id: i64,
}

/// Result of walking every enabled source of a drive's mount: the media
/// files found, any per-entry I/O errors (e.g. a permission-denied
/// subdirectory), and whether the walk stopped early because of
/// cancellation.
struct WalkResult {
    files: Vec<ScannedFile>,
    /// `(path, message)` pairs for entries walkdir couldn't read.
    errors: Vec<(String, String)>,
    stopped_early: bool,
}

/// `mount/rel_path`, or `mount` itself when `rel_path` is empty (a source
/// rooted at the mount).
fn source_root(mount: &Path, rel_path: &str) -> PathBuf {
    if rel_path.is_empty() {
        mount.to_path_buf()
    } else {
        mount.join(rel_path)
    }
}

/// `rel_path` for display in a walk-progress message, `"/"` standing in
/// for the mount root.
fn source_display(rel_path: &str) -> &str {
    if rel_path.is_empty() {
        "/"
    } else {
        rel_path
    }
}

/// Sends a `Progress` event with `done: 0, total: 0` and a `current`
/// starting `"Scanning "` — a distinct, lightweight signal (from the
/// per-file progress emitted later, once the walk is done and processing
/// starts) that the walk itself is still under way. Called from the
/// blocking walk thread via `Sender::blocking_send`, which is safe here
/// since this runs outside the async runtime (inside
/// `spawn_blocking`) — it never contends with the receiver, which is a
/// separate always-draining task. Silently drops the event if the
/// receiver has gone away.
fn emit_walk_progress(job_id: &str, events: &mpsc::Sender<JobEvent>, current: &str) {
    let _ = events.blocking_send(JobEvent::Progress {
        job_id: job_id.to_string(),
        done: 0,
        total: 0,
        current: Some(current.to_string()),
    });
}

/// Walks every entry of `sources` (each rooted at `mount.join(rel_path)`),
/// skipping anything on the safety deny-list ([`is_denied_path`], checked
/// mount-relative against `mount`), returning every file whose extension
/// maps to a [`MediaKind`]. Runs synchronously (intended for
/// [`tokio::task::spawn_blocking`]): checks `cancel` on each entry so a
/// long walk can be interrupted, records (rather than silently dropping)
/// any entry walkdir fails to read, and emits a lightweight walk-progress
/// event via `events` once at the start of each source and at most every
/// [`WALK_PROGRESS_INTERVAL`] entries thereafter.
fn collect_media_files(
    mount: &Path,
    sources: &[Source],
    home: Option<&Path>,
    cancel: &CancellationToken,
    job_id: &str,
    events: &mpsc::Sender<JobEvent>,
) -> WalkResult {
    let mut files = Vec::new();
    let mut errors = Vec::new();
    let mut stopped_early = false;

    'sources: for source in sources {
        let root = source_root(mount, &source.rel_path);
        emit_walk_progress(
            job_id,
            events,
            &format!("Scanning {}", source_display(&source.rel_path)),
        );

        let walker = WalkDir::new(&root)
            .into_iter()
            .filter_entry(|e| !is_denied_path(e.path(), mount, home));

        let mut entries_since_progress: u64 = 0;
        for entry in walker {
            if cancel.is_cancelled() {
                stopped_early = true;
                break 'sources;
            }

            let entry = match entry {
                Ok(e) => e,
                Err(err) => {
                    let path = err.path().map(|p| p.display().to_string()).unwrap_or_default();
                    errors.push((path, err.to_string()));
                    continue;
                }
            };

            entries_since_progress += 1;
            if entries_since_progress >= WALK_PROGRESS_INTERVAL {
                entries_since_progress = 0;
                let label = rel_path(entry.path(), mount).unwrap_or_default();
                emit_walk_progress(job_id, events, &format!("Scanning {label}"));
            }

            if !entry.file_type().is_file() {
                continue;
            }
            let Some(ext) = entry.path().extension().and_then(|e| e.to_str()) else {
                continue;
            };
            let Some((kind, canonical_ext)) = MediaKind::from_ext(ext) else {
                continue;
            };
            files.push(ScannedFile {
                path: entry.into_path(),
                ext: canonical_ext,
                kind,
                source_id: source.id,
            });
        }
    }

    WalkResult {
        files,
        errors,
        stopped_early,
    }
}

/// Path of `path` relative to `mount`, using forward slashes. `None`
/// if `path` isn't actually inside `mount`.
fn rel_path(path: &Path, mount: &Path) -> Option<String> {
    let rel = path.strip_prefix(mount).ok()?;
    Some(
        rel.components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/"),
    )
}

#[allow(clippy::too_many_arguments)]
async fn process_file(
    ctx: &JobCtx,
    job: &ScanJob,
    mount: &Path,
    file: ScannedFile,
    total: u64,
    done: &AtomicU64,
    ok: &AtomicU64,
    failed: &AtomicU64,
    skipped: &AtomicU64,
    stopped_early: &AtomicBool,
) {
    if ctx.cancel.is_cancelled() {
        stopped_early.store(true, Ordering::SeqCst);
        return;
    }

    let deps = &job.deps;
    let drive_id = job.drive.id;
    let job_id = job.id();
    let path_display = file.path.display().to_string();
    let Some(rel) = rel_path(&file.path, mount) else {
        report_item_error_raw(
            ctx,
            deps,
            job_id,
            drive_id,
            &path_display,
            "path",
            "file is outside the drive root",
        )
        .await;
        failed.fetch_add(1, Ordering::SeqCst);
        advance_progress(ctx, job_id, done, total, &path_display).await;
        return;
    };
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

    // A thumbnail failure on a very small file usually means the file
    // isn't a real photo/video at all (a corrupt copy, an OS-generated
    // placeholder, ...) rather than a real-but-broken media file worth
    // cataloging with a thumb error. Those are rejected outright instead
    // of being upserted — see `STUB_MAX_BYTES`.
    let mut is_stub = false;
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
                if size < STUB_MAX_BYTES {
                    is_stub = true;
                    break;
                }
                had_error = true;
                report_item_error(ctx, deps, job_id, drive_id, &rel, &e).await;
            }
        }
    }

    if is_stub {
        report_item_error_raw(
            ctx,
            deps,
            job_id,
            drive_id,
            &rel,
            "stub",
            "file is too small to be a real photo/video (thumbnail generation failed)",
        )
        .await;
        skipped.fetch_add(1, Ordering::SeqCst);
        advance_progress(ctx, job_id, done, total, &rel).await;
        return;
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
        organized_at: None,
        source_id: Some(file.source_id),
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
    report_item_error_raw(ctx, deps, job_id, drive_id, path, error_code(e), &e.to_string()).await;
}

/// Emits an `ItemError` and records it in the catalog from a raw `code` +
/// `message`, for errors (e.g. walkdir I/O failures) that don't originate
/// as a [`DpError`].
async fn report_item_error_raw(
    ctx: &JobCtx,
    deps: &ScanDeps,
    job_id: &str,
    drive_id: i64,
    path: &str,
    code: &str,
    message: &str,
) {
    let _ = ctx
        .events
        .send(JobEvent::ItemError {
            job_id: job_id.to_string(),
            path: path.to_string(),
            code: code.to_string(),
            message: message.to_string(),
        })
        .await;
    let _ = deps
        .catalog
        .record_scan_error(drive_id, path, code, message)
        .await;
}

#[cfg(test)]
mod tests {
    use super::rel_path;
    use std::path::Path;

    #[test]
    fn rel_path_strips_mount_prefix() {
        assert_eq!(
            rel_path(Path::new("/Volumes/A/x/y.jpg"), Path::new("/Volumes/A")),
            Some("x/y.jpg".to_string())
        );
    }

    #[test]
    fn rel_path_none_when_outside_mount() {
        assert_eq!(
            rel_path(Path::new("/elsewhere/y.jpg"), Path::new("/Volumes/A")),
            None
        );
    }
}
