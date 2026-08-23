use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use dp_catalog::Catalog;
use dp_core::denylist::is_denied_path;
use dp_core::{DpError, DpResult, Drive, MediaKind, MediaMetadata, NewMedia, Source};
use dp_hash::Hasher;
use dp_metadata::{MetadataProvider, Sidecars};
use dp_thumbs::{ThumbChain, ThumbStore, THUMB_SIZES};
use futures::stream::{self, StreamExt};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use walkdir::WalkDir;

use crate::prune::prune_denied_legacy_rows;
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
    /// Reads/writes each media file's XMP sidecar's `XMP-dc:Subject` list.
    /// After a file is upserted, its sidecar (if any) is read and its
    /// subjects imported as catalog tags — see [`import_sidecar_tags`].
    pub sidecars: Arc<dyn Sidecars>,
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

        let sources: Vec<Source> = self.sources.iter().filter(|s| s.enabled).cloned().collect();

        // Canonicalizing the mount is blocking I/O, so it — along with the
        // nested-source dedup that depends on it and the walk itself —
        // runs entirely inside `spawn_blocking` rather than on the async
        // worker thread.
        let walk_cancel = ctx.cancel.clone();
        let walk_home = self.deps.home.clone();
        let walk_events = ctx.events.clone();
        let walk_job_id = self.id.clone();
        let walk_mount_path = mount_path.clone();
        let (mount, walk) = tokio::task::spawn_blocking(move || -> DpResult<(PathBuf, WalkResult)> {
            let mount = std::fs::canonicalize(&walk_mount_path).map_err(|e| DpError::Io {
                message: format!("failed to canonicalize mount path: {e}"),
                path: Some(walk_mount_path.clone()),
            })?;
            let sources = dedup_nested_sources(&mount, sources);
            let result = collect_media_files(
                &mount,
                &sources,
                walk_home.as_deref(),
                &walk_cancel,
                &walk_job_id,
                &walk_events,
            );
            Ok((mount, result))
        })
        .await
        .map_err(|e| DpError::Io {
            message: format!("scan walk task failed: {e}"),
            path: None,
        })??;

        // Legacy rows (scanned before sources existed) pointing at paths
        // today's deny-list refuses can never be re-created — or
        // resolved — by a scan, since the walk above skips those very
        // paths. Clear them here, now that the canonical `mount` the
        // walk used is in hand, so they stop being reported as "re-scan
        // to include these". A failure here must not fail the scan
        // itself: the files were still indexed.
        match prune_denied_legacy_rows(
            &self.deps.catalog,
            self.drive.id,
            &mount,
            self.deps.home.as_deref(),
        )
        .await
        {
            Ok(0) => {}
            Ok(pruned) => tracing::info!(
                drive_id = self.drive.id,
                pruned,
                "pruned legacy media rows under paths the deny-list now refuses"
            ),
            Err(e) => tracing::warn!(
                error = %e,
                drive_id = self.drive.id,
                "failed to prune legacy media rows under denied paths"
            ),
        }

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

/// `path` (a directory) for display in a walk-progress message, relative
/// to `mount` — `"/"` standing in for the mount root itself.
fn dir_label(path: &Path, mount: &Path) -> String {
    let rel = rel_path(path, mount).unwrap_or_default();
    if rel.is_empty() {
        "/".to_string()
    } else {
        rel
    }
}

/// Resolves each enabled source's walk root to its real filesystem
/// identity, then drops sources that would duplicate or escape another's
/// walk, returning `(source, root_to_walk)` pairs for what's left.
///
/// Deduping by the *lexical* path (`mount.join(rel_path)` compared as
/// strings/components) isn't enough: on a case-insensitive filesystem
/// (APFS, by default) `"DCIM"` and `"dcim"` are the same directory but
/// don't compare equal lexically, and a source that's a symlink to
/// another source's target is a different lexical path pointing at the
/// identical inode. Both would otherwise be walked — and every file
/// under them upserted — twice. So each source's root is resolved with
/// [`std::fs::canonicalize`] (which both fixes casing to the on-disk
/// spelling and fully resolves symlinks) before any comparison:
///
/// - A root that fails to canonicalize (the configured folder is
///   missing, unreadable, ...) is **kept as-is**, walked at its literal
///   `mount.join(rel_path)` — [`collect_media_files`] will naturally
///   report an `io` item error for it, same as it already does for any
///   other unreadable path. It's excluded from the containment
///   comparisons below, since nothing is known about where it would
///   really point.
/// - A root that canonicalizes to somewhere outside the canonical
///   `mount` (e.g. a symlink escaping the drive) is dropped entirely —
///   logged, never walked.
/// - Among the remaining, successfully-resolved sources, one whose
///   canonical root is a descendant of (or identical to) another's is
///   dropped, keeping the shallowest (by canonical path-component count)
///   survivor of each overlapping/duplicate group. Ties (equal depth)
///   can't nest each other and are all kept.
///
/// Every dropped source is logged via `tracing::info!` along with why.
fn dedup_nested_sources(mount: &Path, sources: Vec<Source>) -> Vec<(Source, PathBuf)> {
    let mut resolvable: Vec<(Source, PathBuf)> = Vec::new();
    let mut unresolved: Vec<(Source, PathBuf)> = Vec::new();

    for s in sources {
        let literal_root = source_root(mount, &s.rel_path);
        match std::fs::canonicalize(&literal_root) {
            Ok(canon) if canon.starts_with(mount) => resolvable.push((s, canon)),
            Ok(canon) => {
                tracing::info!(
                    source_id = s.id,
                    rel_path = %s.rel_path,
                    canonical_root = %canon.display(),
                    "dropping scan source whose canonical root escapes the drive mount"
                );
            }
            Err(e) => {
                tracing::info!(
                    source_id = s.id,
                    rel_path = %s.rel_path,
                    error = %e,
                    "scan source root could not be resolved; walking it as configured (expect an io item error)"
                );
                unresolved.push((s, literal_root));
            }
        }
    }

    // Shallowest canonical root first, so a shallower source is always
    // considered — and can cover a deeper one — before that deeper
    // source is checked.
    resolvable.sort_by_key(|(_, canon)| canon.components().count());

    let mut kept: Vec<(Source, PathBuf)> = Vec::with_capacity(resolvable.len());
    for (s, canon) in resolvable {
        if let Some((covering, _)) = kept.iter().find(|(_, kept_canon)| canon.starts_with(kept_canon)) {
            tracing::info!(
                skipped_source_id = s.id,
                skipped_rel_path = %s.rel_path,
                covering_source_id = covering.id,
                covering_rel_path = %covering.rel_path,
                "skipping nested/overlapping scan source"
            );
            continue;
        }
        kept.push((s, canon));
    }

    kept.into_iter().chain(unresolved).collect()
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

/// Walks every entry of `sources` (each `(source, root)` pair already
/// resolved and deduped by [`dedup_nested_sources`] — `root` is that
/// source's canonical walk root, or its literal `mount.join(rel_path)`
/// when canonicalization failed), skipping anything on the safety
/// deny-list ([`is_denied_path`], checked mount-relative against
/// `mount`), returning every file whose extension maps to a
/// [`MediaKind`]. Runs synchronously (intended for
/// [`tokio::task::spawn_blocking`]): checks `cancel` on each entry so a
/// long walk can be interrupted, records (rather than silently dropping)
/// any entry walkdir fails to read, and emits a lightweight walk-progress
/// event via `events` once at the start of each source and at most every
/// [`WALK_PROGRESS_INTERVAL`] entries thereafter.
fn collect_media_files(
    mount: &Path,
    sources: &[(Source, PathBuf)],
    home: Option<&Path>,
    cancel: &CancellationToken,
    job_id: &str,
    events: &mpsc::Sender<JobEvent>,
) -> WalkResult {
    let mut files = Vec::new();
    let mut errors = Vec::new();
    let mut stopped_early = false;

    'sources: for (source, root) in sources {
        emit_walk_progress(job_id, events, &format!("Scanning {}", dir_label(root, mount)));

        let walker = WalkDir::new(root)
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
                let dir_path = if entry.file_type().is_dir() {
                    entry.path()
                } else {
                    entry.path().parent().unwrap_or(mount)
                };
                let label = dir_label(dir_path, mount);
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
    // of being upserted — see `STUB_MAX_BYTES`. A file only counts as a
    // stub if *no* size ever rendered successfully: every size is still
    // attempted (no early `break`), so a small file that fails at 400px
    // but succeeds at 2000px is accepted like any other real file, with
    // the 400px failure reported below like a normal thumb error.
    let mut any_thumb_ok = false;
    let mut had_thumb_failure = false;
    let mut small_file_failures: Vec<DpError> = Vec::new();
    for size_px in THUMB_SIZES {
        if deps.store.exists(&hash, size_px) {
            any_thumb_ok = true;
            continue;
        }
        let render_result = deps.thumbs.render(&file.path, file.ext, size_px).await;
        match render_result {
            Ok(img) => {
                any_thumb_ok = true;
                if let Err(e) = deps.store.write(&hash, size_px, &img).await {
                    had_error = true;
                    report_item_error(ctx, deps, job_id, drive_id, &rel, &e).await;
                }
            }
            Err(e) => {
                had_thumb_failure = true;
                if size >= STUB_MAX_BYTES {
                    had_error = true;
                    report_item_error(ctx, deps, job_id, drive_id, &rel, &e).await;
                } else {
                    // Deferred: only actually reported below if this file
                    // turns out not to be a stub after all.
                    small_file_failures.push(e);
                }
            }
        }
    }
    let is_stub = size < STUB_MAX_BYTES && had_thumb_failure && !any_thumb_ok;

    if !is_stub {
        for e in small_file_failures {
            had_error = true;
            report_item_error(ctx, deps, job_id, drive_id, &rel, &e).await;
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

    match deps.catalog.upsert_media(new_media).await {
        Ok(media_id) => {
            import_sidecar_tags(ctx, deps, job_id, drive_id, &file.path, &rel, media_id).await;
        }
        Err(e) => {
            had_error = true;
            report_item_error(ctx, deps, job_id, drive_id, &rel, &e).await;
        }
    }

    if had_error {
        failed.fetch_add(1, Ordering::SeqCst);
    } else {
        ok.fetch_add(1, Ordering::SeqCst);
    }

    advance_progress(ctx, job_id, done, total, &rel).await;
}

/// Imports `media_path`'s XMP sidecar subjects (if any) as catalog tags on
/// `media_id`, right after it's been upserted. `Sidecars::read_subjects`
/// already returns `Ok(vec![])` when no sidecar exists, so a file with no
/// sidecar is a no-op here — no explicit existence check needed.
///
/// Empty/whitespace-only subject strings are filtered out before reaching
/// `tag_media`, so a stray blank entry in the sidecar can never become an
/// empty-named tag. The import is a pure union (`tag_media(&[media_id],
/// &subjects, &[])`) — it never removes a catalog tag.
///
/// `tag_media` marks a row sidecar-pending on *any* real tag-set change
/// (Task 4a.1), which would otherwise leave a freshly-imported row pending
/// even though the sidecar already holds exactly what was just imported —
/// the sync job would then rewrite every such sidecar once, for nothing.
/// So after the `tag_media` call, this re-fetches the row's full tag set
/// via `tag_names_for_media` and compares it against the imported
/// `subjects`, case-insensitively as sets:
/// - Equal (the common case — the row's tags now exactly mirror the
///   sidecar) → `clear_sidecar_pending(media_id)`: the sidecar already
///   holds the truth, there's nothing to sync back.
/// - Not equal (the row already carried catalog tags beyond the sidecar's
///   subjects) → leave pending, so the sync job writes the union back to
///   the sidecar.
///
/// This is the *only* place scan ever calls `clear_sidecar_pending` — it
/// never blindly clears an already-pending row for any other reason.
///
/// A sidecar read failure (missing `exiftool`, corrupt/unparsable XMP, ...)
/// is recorded via [`report_item_error`] and otherwise ignored — it must
/// never fail the media file itself, which has already been cataloged
/// successfully by the time this runs.
async fn import_sidecar_tags(
    ctx: &JobCtx,
    deps: &ScanDeps,
    job_id: &str,
    drive_id: i64,
    media_path: &Path,
    rel: &str,
    media_id: i64,
) {
    let subjects = match deps.sidecars.read_subjects(media_path).await {
        Ok(subjects) => subjects,
        Err(e) => {
            report_item_error(ctx, deps, job_id, drive_id, rel, &e).await;
            return;
        }
    };

    let subjects: Vec<String> = subjects.into_iter().filter(|s| !s.trim().is_empty()).collect();
    if subjects.is_empty() {
        return;
    }

    if let Err(e) = deps.catalog.tag_media(&[media_id], &subjects, &[]).await {
        report_item_error(ctx, deps, job_id, drive_id, rel, &e).await;
        return;
    }

    match deps.catalog.tag_names_for_media(media_id).await {
        Ok(catalog_names) => {
            if tag_sets_match_case_insensitive(&catalog_names, &subjects) {
                if let Err(e) = deps.catalog.clear_sidecar_pending(media_id).await {
                    report_item_error(ctx, deps, job_id, drive_id, rel, &e).await;
                }
            }
        }
        Err(e) => {
            report_item_error(ctx, deps, job_id, drive_id, rel, &e).await;
        }
    }
}

/// Whether `a` and `b` contain the same names, ignoring order, duplicates,
/// and case — used to decide whether a row's full catalog tag set now
/// exactly mirrors what was just imported from its sidecar (see
/// [`import_sidecar_tags`]).
fn tag_sets_match_case_insensitive(a: &[String], b: &[String]) -> bool {
    let a: std::collections::HashSet<String> = a.iter().map(|s| s.to_lowercase()).collect();
    let b: std::collections::HashSet<String> = b.iter().map(|s| s.to_lowercase()).collect();
    a == b
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
