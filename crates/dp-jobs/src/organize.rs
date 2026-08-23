//! [`OrganizeJob`]: applies a pre-computed organize plan by moving each
//! `Planned` item into place, recording the outcome of every item in the
//! catalog, and reporting progress along the way.

use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use dp_catalog::Catalog;
use dp_core::denylist::is_denied_path;
use dp_core::{DpError, DpResult, Drive, OrganizeItemRow, OrganizePlanItem, PlanStatus};
use dp_organize::MoveStrategy;
use futures::FutureExt;

use crate::{error_code, Job, JobCtx, JobEvent, JobOutcome};

/// How many items are applied between two checks that the drive is
/// still mounted. A drive yanked mid-run would otherwise have every
/// single remaining item fail its own way through the filesystem — one
/// pointless `ItemError` per photo — instead of the run stopping at the
/// first sign the destination isn't there any more.
const MOUNT_RECHECK_INTERVAL: usize = 50;

/// External dependencies an [`OrganizeJob`] needs, injected so tests can
/// swap in fakes/in-memory implementations.
pub struct OrganizeDeps {
    pub catalog: Arc<dyn Catalog>,
    pub strategy: Arc<dyn MoveStrategy>,
    /// The current user's home directory (`$HOME`), used for the
    /// deny-list's `home/Library` rule (see
    /// [`dp_core::denylist::is_denied_path`]) when [`OrganizeJob::apply_move`]
    /// double-checks each move's source and destination against it just
    /// before touching the filesystem. `None` when it couldn't be
    /// resolved, which simply skips that one rule rather than failing
    /// every move.
    pub home: Option<PathBuf>,
}

/// A [`Job`] that applies a pre-computed organize plan (`items`,
/// typically produced by [`dp_organize::plan`]): moving each `Planned`
/// item to its target path and recording `Moved`/`Failed`, while
/// `SkippedDup`/`SkippedCollision` items are simply recorded as-is
/// without ever touching their files.
pub struct OrganizeJob {
    id: String,
    drive: Drive,
    job_row_id: i64,
    items: Vec<OrganizePlanItem>,
    deps: OrganizeDeps,
    /// Live tallies, kept on the job itself rather than as `run_inner`
    /// locals so that *both* the normal path and the panic handler in
    /// [`Job::run`] report the same, real numbers — a panic partway
    /// through used to close the job row out as `0/0/0`, silently
    /// disowning every item that had already been moved.
    moved: AtomicU64,
    skipped: AtomicU64,
    failed: AtomicU64,
}

impl OrganizeJob {
    pub fn new(
        id: String,
        drive: Drive,
        job_row_id: i64,
        items: Vec<OrganizePlanItem>,
        deps: OrganizeDeps,
    ) -> Self {
        Self {
            id,
            drive,
            job_row_id,
            items,
            deps,
            moved: AtomicU64::new(0),
            skipped: AtomicU64::new(0),
            failed: AtomicU64::new(0),
        }
    }
}

#[async_trait]
impl Job for OrganizeJob {
    fn id(&self) -> &str {
        &self.id
    }

    /// Data-safety invariant: a failed `move_file` NEVER triggers a
    /// delete, rollback, or any other touch of `to` — the item is simply
    /// recorded `Failed` with the error message, and the job moves on to
    /// the next item. There is no cleanup path here by design: a
    /// half-applied move is left exactly as `move_file` left it, for a
    /// human (or a re-plan-and-retry) to deal with, never for this job
    /// to guess at.
    ///
    /// The whole body runs behind `catch_unwind`: a panic partway through
    /// would otherwise leave the `organize_jobs` row stuck `"running"`
    /// forever (the runner's own panic handling wraps `Job::run` itself,
    /// which by then is too late to still call `finish_organize_job`).
    /// On a panic we close the row out as `"failed"` — with the tallies
    /// of everything that *did* get applied first — and turn it into an
    /// ordinary `Err` so the runner's normal Finished/ItemError reporting
    /// still applies.
    async fn run(&self, ctx: JobCtx) -> DpResult<JobOutcome> {
        match std::panic::AssertUnwindSafe(self.run_inner(&ctx))
            .catch_unwind()
            .await
        {
            Ok(result) => result,
            Err(_panic) => {
                let (moved, skipped, failed) = self.totals();
                self.finish_row("failed", moved, skipped, failed).await;
                Err(DpError::Io {
                    message: "job panicked".into(),
                    path: None,
                })
            }
        }
    }
}

impl OrganizeJob {
    async fn run_inner(&self, ctx: &JobCtx) -> DpResult<JobOutcome> {
        let mount_path = match &self.drive.mount_path {
            Some(m) => m.clone(),
            None => {
                self.finish_row("failed", 0, 0, 0).await;
                return Err(DpError::NotFound {
                    message: "drive is offline".into(),
                });
            }
        };

        let mut cancelled = false;
        let total = self.items.len() as u64;

        for (i, item) in self.items.iter().enumerate() {
            if ctx.cancel.is_cancelled() {
                cancelled = true;
                break;
            }

            if i % MOUNT_RECHECK_INTERVAL == 0 && !mount_online(&mount_path).await {
                let (moved, skipped, failed) = self.totals();
                self.finish_row("failed", moved, skipped, failed).await;
                return Err(DpError::NotFound {
                    message: "drive went offline".into(),
                });
            }

            if item.status == PlanStatus::Planned {
                if self.apply_move(ctx, &mount_path, item).await {
                    self.moved.fetch_add(1, Ordering::Relaxed);
                } else {
                    self.failed.fetch_add(1, Ordering::Relaxed);
                }
            } else {
                self.record_as_is(item).await;
                self.skipped.fetch_add(1, Ordering::Relaxed);
            }

            let done = (i + 1) as u64;
            let _ = ctx
                .events
                .send(JobEvent::Progress {
                    job_id: self.id.clone(),
                    done,
                    total,
                    current: Some(item.old_rel_path.clone()),
                })
                .await;
        }

        let (ok, skipped, failed) = self.totals();
        let outcome = JobOutcome {
            ok,
            failed,
            skipped,
            cancelled,
        };
        let status = if cancelled { "cancelled" } else { "done" };
        self.finish_row(status, outcome.ok, outcome.skipped, outcome.failed)
            .await;

        Ok(outcome)
    }

    /// The `(moved, skipped, failed)` tallies applied so far.
    fn totals(&self) -> (u64, u64, u64) {
        (
            self.moved.load(Ordering::Relaxed),
            self.skipped.load(Ordering::Relaxed),
            self.failed.load(Ordering::Relaxed),
        )
    }

    /// Closes this job's `organize_jobs` row out, logging (rather than
    /// propagating) a catalog failure — the run's own outcome is what
    /// the caller cares about, and there's nothing useful to do about a
    /// catalog that won't take the final update.
    async fn finish_row(&self, status: &str, moved: u64, skipped: u64, failed: u64) {
        if let Err(e) = self
            .deps
            .catalog
            .finish_organize_job(self.job_row_id, status, moved, skipped, failed)
            .await
        {
            tracing::warn!(error = %e, job_row_id = self.job_row_id, status, "failed to finish organize job");
        }
    }

    /// Moves one `Planned` item under `mount_path`: on success, marks the
    /// media organized in the catalog and records the item `Moved`; on
    /// failure (either the move itself, or the catalog update that
    /// follows a successful move), records the item `Failed` and emits an
    /// `ItemError` event. Returns whether the item ended up fully applied
    /// (moved *and* recorded).
    ///
    /// Before ever touching the filesystem, two checks stand between a
    /// bad plan and the user's files:
    ///
    /// 1. [`escapes_mount`], applied to *both* `new_rel_path` and
    ///    `old_rel_path` — a `root`/template that somehow produced an
    ///    absolute path or a `..` component would otherwise have
    ///    `Path::join` escape the drive entirely (and a poisoned
    ///    `old_rel_path` would have the job read from outside it).
    ///    `save_rule`/`validate_template` are expected to reject such
    ///    rules long before a job ever sees them.
    /// 2. [`destination_is_inside`] — `escapes_mount` is purely lexical,
    ///    so a *directory symlink* sitting inside the mount (say
    ///    `<mount>/archive` pointing at someone's home directory) would
    ///    sail past it and have the move write outside the drive.
    /// 3. [`dp_core::denylist::is_denied_path`], applied to *both* `to`
    ///    and `from` — the organize safety deny-list. Nothing upstream
    ///    (the planner, `save_rule`/`validate_root`) re-checks a row's
    ///    *source* path against the deny-list once it's already in the
    ///    catalog, and a template could in principle render a destination
    ///    under a denied name (e.g. a literal `root` of `Caches`); this is
    ///    the last line of defense before either side of a move touches
    ///    the filesystem.
    async fn apply_move(&self, ctx: &JobCtx, mount_path: &str, item: &OrganizePlanItem) -> bool {
        let mount = Path::new(mount_path);
        let to = mount.join(&item.new_rel_path);
        let from = mount.join(&item.old_rel_path);

        if escapes_mount(&item.new_rel_path, &to, mount) || escapes_mount(&item.old_rel_path, &from, mount) {
            self.record_failed(ctx, item, "path", "path escapes the drive root".into())
                .await;
            return false;
        }

        let home = self.deps.home.as_deref();
        if is_denied_path(&to, mount, home) || is_denied_path(&from, mount, home) {
            self.record_failed(ctx, item, "denied", "path is on the safety deny-list".into())
                .await;
            return false;
        }

        if !destination_stays_on_drive(&to, mount).await {
            self.record_failed(ctx, item, "path", "destination resolves outside the drive".into())
                .await;
            return false;
        }

        match self.deps.strategy.move_file(&from, &to).await {
            Ok(()) => match self
                .deps
                .catalog
                .mark_media_organized(item.media_id, &item.new_rel_path)
                .await
            {
                Ok(()) => {
                    self.insert_item(item, PlanStatus::Moved, None).await;
                    true
                }
                Err(e) => {
                    let message = format!("moved but catalog update failed: {e}");
                    self.record_failed(ctx, item, error_code(&e), message).await;
                    false
                }
            },
            Err(e) => {
                self.record_failed(ctx, item, error_code(&e), e.to_string()).await;
                false
            }
        }
    }

    /// Records `item` `Failed` with `message`, and emits a matching
    /// `ItemError` event.
    async fn record_failed(&self, ctx: &JobCtx, item: &OrganizePlanItem, code: &str, message: String) {
        self.insert_item(item, PlanStatus::Failed, Some(message.clone()))
            .await;
        let _ = ctx
            .events
            .send(JobEvent::ItemError {
                job_id: self.id.clone(),
                path: item.old_rel_path.clone(),
                code: code.to_string(),
                message,
            })
            .await;
    }

    /// Records an already-decided skip (`SkippedDup`/`SkippedCollision`,
    /// or defensively any other non-`Planned` status the caller hands
    /// us) exactly as planned, without touching its file.
    async fn record_as_is(&self, item: &OrganizePlanItem) {
        self.insert_item(item, item.status, item.reason.clone()).await;
    }

    async fn insert_item(&self, item: &OrganizePlanItem, status: PlanStatus, error: Option<String>) {
        if let Err(e) = self
            .deps
            .catalog
            .insert_organize_item(&OrganizeItemRow {
                id: 0,
                job_id: self.job_row_id,
                media_id: item.media_id,
                old_rel_path: item.old_rel_path.clone(),
                new_rel_path: item.new_rel_path.clone(),
                status,
                error,
            })
            .await
        {
            tracing::warn!(error = %e, media_id = item.media_id, "failed to record organize item");
        }
    }
}

/// Whether `new_rel_path` (rendered relative to `mount`, yielding `to`)
/// would escape `mount`: either because it contains a component that
/// isn't a plain path segment (an absolute-path root/prefix, or a `.`/
/// `..` traversal component), or because the resulting joined path
/// doesn't actually stay under `mount`.
///
/// Purely lexical — it says nothing about what the path *resolves* to
/// once symlinks are followed; that's [`destination_is_inside`]'s job.
fn escapes_mount(new_rel_path: &str, to: &Path, mount: &Path) -> bool {
    let has_unsafe_component = Path::new(new_rel_path).components().any(|c| {
        matches!(
            c,
            Component::RootDir | Component::Prefix(_) | Component::ParentDir | Component::CurDir
        )
    });
    has_unsafe_component || !to.starts_with(mount)
}

/// Whether `to` really lands inside `mount` once symlinks are resolved.
///
/// `to` itself usually doesn't exist yet (that's the whole point of the
/// move), so this resolves the deepest ancestor of `to` that *does*
/// exist — `mount` at worst, since `to` is always built by joining onto
/// it — and requires that to sit under the canonical `mount`. A
/// directory symlink planted anywhere along the way (`<mount>/archive`
/// → `/Users/me/Pictures`) therefore fails here, before a single byte
/// is written outside the drive.
///
/// Anything that can't be proven inside is treated as outside: a mount
/// that won't canonicalize (the drive vanished), a dangling symlink, a
/// path whose ancestors have all disappeared.
fn destination_is_inside(to: &Path, mount: &Path) -> bool {
    let Ok(mount_real) = mount.canonicalize() else {
        return false;
    };

    let mut candidate = Some(to);
    while let Some(path) = candidate {
        if std::fs::symlink_metadata(path).is_ok() {
            return match path.canonicalize() {
                Ok(real) => real.starts_with(&mount_real),
                Err(_) => false,
            };
        }
        candidate = path.parent();
    }

    false
}

/// [`destination_is_inside`] off the async runtime — it stats and
/// canonicalizes real paths, which can block on a slow/spinning drive.
async fn destination_stays_on_drive(to: &Path, mount: &Path) -> bool {
    let to = to.to_path_buf();
    let mount = mount.to_path_buf();
    tokio::task::spawn_blocking(move || destination_is_inside(&to, &mount))
        .await
        .unwrap_or(false)
}

/// Whether the drive is still mounted where the job expects it.
fn mount_is_online(mount_path: &str) -> bool {
    Path::new(mount_path).exists()
}

/// [`mount_is_online`] off the async runtime. A join error is read as
/// "still online" so a runtime hiccup can never abort a healthy run —
/// the per-item errors remain the backstop if the drive really is gone.
async fn mount_online(mount_path: &str) -> bool {
    let mount_path = mount_path.to_string();
    tokio::task::spawn_blocking(move || mount_is_online(&mount_path))
        .await
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::{destination_is_inside, escapes_mount, mount_is_online};
    use std::path::Path;

    #[test]
    fn escapes_mount_rejects_parent_dir_component() {
        let mount = Path::new("/Volumes/A");
        let to = mount.join("../escape.jpg");
        assert!(escapes_mount("../escape.jpg", &to, mount));
    }

    #[test]
    fn escapes_mount_rejects_absolute_new_path() {
        let mount = Path::new("/Volumes/A");
        let to = Path::new("/etc/passwd");
        assert!(escapes_mount("/etc/passwd", to, mount));
    }

    #[test]
    fn escapes_mount_allows_a_plain_relative_path() {
        let mount = Path::new("/Volumes/A");
        let to = mount.join("archive/2025/Q3/2025-09-12_a.jpg");
        assert!(!escapes_mount("archive/2025/Q3/2025-09-12_a.jpg", &to, mount));
    }

    #[test]
    fn destination_is_inside_accepts_a_not_yet_created_subdirectory() {
        let mount = tempfile::tempdir().unwrap();
        let to = mount.path().join("archive/2025/Q3/a.jpg");
        assert!(destination_is_inside(&to, mount.path()));
    }

    #[test]
    fn destination_is_inside_rejects_a_directory_symlink_pointing_out_of_the_mount() {
        let mount = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), mount.path().join("archive")).unwrap();

        let to = mount.path().join("archive/2025/Q3/a.jpg");
        assert!(!destination_is_inside(&to, mount.path()));
    }

    #[test]
    fn destination_is_inside_rejects_a_mount_that_does_not_exist() {
        let mount = Path::new("/definitely/not/a/mount/point/dp-organize");
        assert!(!destination_is_inside(&mount.join("a.jpg"), mount));
    }

    #[test]
    fn mount_is_online_is_false_for_a_missing_path() {
        assert!(!mount_is_online("/definitely/not/a/mount/point/dp-organize"));
    }

    #[test]
    fn mount_is_online_is_true_for_a_mounted_path() {
        let dir = tempfile::tempdir().unwrap();
        assert!(mount_is_online(&dir.path().to_string_lossy()));
    }
}
