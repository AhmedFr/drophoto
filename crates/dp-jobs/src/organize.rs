//! [`OrganizeJob`]: applies a pre-computed organize plan by moving each
//! `Planned` item into place, recording the outcome of every item in the
//! catalog, and reporting progress along the way.

use std::path::{Component, Path};
use std::sync::Arc;

use async_trait::async_trait;
use dp_catalog::Catalog;
use dp_core::{DpError, DpResult, Drive, OrganizeItemRow, OrganizePlanItem, PlanStatus};
use dp_organize::MoveStrategy;
use futures::FutureExt;

use crate::{error_code, Job, JobCtx, JobEvent, JobOutcome};

/// External dependencies an [`OrganizeJob`] needs, injected so tests can
/// swap in fakes/in-memory implementations.
pub struct OrganizeDeps {
    pub catalog: Arc<dyn Catalog>,
    pub strategy: Arc<dyn MoveStrategy>,
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
    /// On a panic we close the row out as `"failed"` and turn it into an
    /// ordinary `Err` so the runner's normal Finished/ItemError reporting
    /// still applies.
    async fn run(&self, ctx: JobCtx) -> DpResult<JobOutcome> {
        match std::panic::AssertUnwindSafe(self.run_inner(&ctx))
            .catch_unwind()
            .await
        {
            Ok(result) => result,
            Err(_panic) => {
                if let Err(e) = self
                    .deps
                    .catalog
                    .finish_organize_job(self.job_row_id, "failed", 0, 0, 0)
                    .await
                {
                    tracing::warn!(error = %e, job_row_id = self.job_row_id, "failed to finish organize job after a panic");
                }
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
                if let Err(e) = self
                    .deps
                    .catalog
                    .finish_organize_job(self.job_row_id, "failed", 0, 0, 0)
                    .await
                {
                    tracing::warn!(error = %e, job_row_id = self.job_row_id, "failed to finish organize job for an offline drive");
                }
                return Err(DpError::NotFound {
                    message: "drive is offline".into(),
                });
            }
        };

        let mut ok = 0u64;
        let mut skipped = 0u64;
        let mut failed = 0u64;
        let mut cancelled = false;
        let total = self.items.len() as u64;

        for (i, item) in self.items.iter().enumerate() {
            if ctx.cancel.is_cancelled() {
                cancelled = true;
                break;
            }

            if item.status == PlanStatus::Planned {
                if self.apply_move(ctx, &mount_path, item).await {
                    ok += 1;
                } else {
                    failed += 1;
                }
            } else {
                self.record_as_is(item).await;
                skipped += 1;
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

        let outcome = JobOutcome {
            ok,
            failed,
            skipped,
            cancelled,
        };
        let status = if cancelled { "cancelled" } else { "done" };
        if let Err(e) = self
            .deps
            .catalog
            .finish_organize_job(
                self.job_row_id,
                status,
                outcome.ok,
                outcome.skipped,
                outcome.failed,
            )
            .await
        {
            tracing::warn!(error = %e, job_row_id = self.job_row_id, "failed to finish organize job");
        }

        Ok(outcome)
    }

    /// Moves one `Planned` item under `mount_path`: on success, marks the
    /// media organized in the catalog and records the item `Moved`; on
    /// failure (either the move itself, or the catalog update that
    /// follows a successful move), records the item `Failed` and emits an
    /// `ItemError` event. Returns whether the item ended up fully applied
    /// (moved *and* recorded).
    ///
    /// Before ever touching the filesystem, verifies `item.new_rel_path`
    /// resolves to a path that actually stays under `mount_path` — a
    /// `root`/template that somehow produced an absolute path or a `..`
    /// component would otherwise have `Path::join` escape the drive
    /// entirely. `save_rule`/`validate_template` are expected to reject
    /// such rules long before a job ever sees them; this is the last line
    /// of defense against a plan that got here anyway.
    async fn apply_move(&self, ctx: &JobCtx, mount_path: &str, item: &OrganizePlanItem) -> bool {
        let mount = Path::new(mount_path);
        let to = mount.join(&item.new_rel_path);

        if escapes_mount(&item.new_rel_path, &to, mount) {
            self.record_failed(ctx, item, "path", "path escapes the drive root".into())
                .await;
            return false;
        }

        let from = mount.join(&item.old_rel_path);

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
fn escapes_mount(new_rel_path: &str, to: &Path, mount: &Path) -> bool {
    let has_unsafe_component = Path::new(new_rel_path).components().any(|c| {
        matches!(
            c,
            Component::RootDir | Component::Prefix(_) | Component::ParentDir | Component::CurDir
        )
    });
    has_unsafe_component || !to.starts_with(mount)
}

#[cfg(test)]
mod tests {
    use super::escapes_mount;
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
}
