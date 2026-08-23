//! [`RevertJob`]: undoes a finished [`crate::OrganizeJob`] by moving every
//! item it actually moved back to its original location, in reverse
//! order, recording the outcome of every item in the catalog.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use async_trait::async_trait;
use dp_core::denylist::is_denied_path;
use dp_core::{DpError, DpResult, Drive, OrganizeItemRow, PlanStatus};
use futures::FutureExt;

use crate::move_guards::{destination_stays_on_drive, escapes_mount, mount_online, MOUNT_RECHECK_INTERVAL};
use crate::{error_code, Job, JobCtx, JobEvent, JobOutcome, OrganizeDeps};

/// A [`Job`] that reverts a finished organize job: for every item that
/// job actually [`PlanStatus::Moved`], moves the file back from its
/// `new_rel_path` to its `old_rel_path` — in the *reverse* of the
/// original order — restoring the catalog row to look exactly as it did
/// before it was ever organized. Items that were never moved
/// (`SkippedDup`/`SkippedCollision`/`Failed`/already-`Planned`) never had
/// their file touched in the first place, so this never touches them
/// either.
///
/// Shares [`OrganizeDeps`] and the filesystem-safety guards in
/// [`crate::move_guards`] with [`crate::OrganizeJob`] — a revert is, at
/// its core, the exact same "move one file under a mount, safely" job
/// run with `from`/`to` swapped.
pub struct RevertJob {
    id: String,
    drive: Drive,
    job_row_id: i64,
    /// Only the original job's `Moved` items, already reversed — see
    /// [`RevertJob::new`].
    items: Vec<OrganizeItemRow>,
    deps: OrganizeDeps,
    moved: AtomicU64,
    failed: AtomicU64,
}

impl RevertJob {
    /// `items` is the *original* organize job's recorded items, in
    /// whatever order they were reported in; only those `status ==
    /// Moved` are kept, and reversed relative to that original order —
    /// undoing a run should unwind it last-move-first, the same way any
    /// other undo stack would.
    pub fn new(
        id: String,
        drive: Drive,
        job_row_id: i64,
        items: Vec<OrganizeItemRow>,
        deps: OrganizeDeps,
    ) -> Self {
        let mut items: Vec<OrganizeItemRow> = items
            .into_iter()
            .filter(|i| i.status == PlanStatus::Moved)
            .collect();
        items.reverse();

        Self {
            id,
            drive,
            job_row_id,
            items,
            deps,
            moved: AtomicU64::new(0),
            failed: AtomicU64::new(0),
        }
    }
}

#[async_trait]
impl Job for RevertJob {
    fn id(&self) -> &str {
        &self.id
    }

    /// See [`crate::OrganizeJob::run`]'s doc comment: the same
    /// data-safety invariant (a failed move is never rolled back or
    /// cleaned up) and the same panic-safety rationale (`catch_unwind`
    /// so a panic partway through still closes the row out with the real
    /// tallies) both apply here unchanged.
    async fn run(&self, ctx: JobCtx) -> DpResult<JobOutcome> {
        match std::panic::AssertUnwindSafe(self.run_inner(&ctx))
            .catch_unwind()
            .await
        {
            Ok(result) => result,
            Err(_panic) => {
                let (moved, failed) = self.totals();
                self.finish_row("failed", moved, failed).await;
                Err(DpError::Io {
                    message: "job panicked".into(),
                    path: None,
                })
            }
        }
    }
}

impl RevertJob {
    async fn run_inner(&self, ctx: &JobCtx) -> DpResult<JobOutcome> {
        let mount_path = match &self.drive.mount_path {
            Some(m) => m.clone(),
            None => {
                self.finish_row("failed", 0, 0).await;
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
                let (moved, failed) = self.totals();
                self.finish_row("failed", moved, failed).await;
                return Err(DpError::NotFound {
                    message: "drive went offline".into(),
                });
            }

            if self.apply_revert(ctx, &mount_path, item).await {
                self.moved.fetch_add(1, Ordering::Relaxed);
            } else {
                self.failed.fetch_add(1, Ordering::Relaxed);
            }

            let done = (i + 1) as u64;
            let _ = ctx
                .events
                .send(JobEvent::Progress {
                    job_id: self.id.clone(),
                    done,
                    total,
                    current: Some(item.new_rel_path.clone()),
                })
                .await;
        }

        let (ok, failed) = self.totals();
        let outcome = JobOutcome {
            ok,
            failed,
            skipped: 0,
            cancelled,
        };
        let status = if cancelled { "cancelled" } else { "done" };
        self.finish_row(status, outcome.ok, outcome.failed).await;

        Ok(outcome)
    }

    fn totals(&self) -> (u64, u64) {
        (
            self.moved.load(Ordering::Relaxed),
            self.failed.load(Ordering::Relaxed),
        )
    }

    async fn finish_row(&self, status: &str, moved: u64, failed: u64) {
        if let Err(e) = self
            .deps
            .catalog
            .finish_organize_job(self.job_row_id, status, moved, 0, failed)
            .await
        {
            tracing::warn!(error = %e, job_row_id = self.job_row_id, status, "failed to finish revert job");
        }
    }

    /// Moves one item back: `from` is its *current* location
    /// (`new_rel_path`, where the organize job left it), `to` is where
    /// it's going back to (`old_rel_path`). Applies the exact same
    /// escapes-mount / deny-list / symlink guards as
    /// [`crate::OrganizeJob::apply_move`] — both sides are just as much
    /// user-controlled paths here as they are on the way in — plus one
    /// revert-specific check: `from` must actually exist, since a
    /// missing source can't be distinguished from "already reverted" any
    /// other way and deserves a clearer message than whatever `rename`
    /// itself would report.
    async fn apply_revert(&self, ctx: &JobCtx, mount_path: &str, item: &OrganizeItemRow) -> bool {
        let mount = Path::new(mount_path);
        let from = mount.join(&item.new_rel_path);
        let to = mount.join(&item.old_rel_path);

        if escapes_mount(&item.new_rel_path, &from, mount) || escapes_mount(&item.old_rel_path, &to, mount) {
            self.record_failed(ctx, item, "path", "path escapes the drive root".into())
                .await;
            return false;
        }

        let home = self.deps.home.as_deref();
        if is_denied_path(&from, mount, home) || is_denied_path(&to, mount, home) {
            self.record_failed(ctx, item, "denied", "path is on the safety deny-list".into())
                .await;
            return false;
        }

        if !destination_stays_on_drive(&to, mount).await {
            self.record_failed(ctx, item, "path", "destination resolves outside the drive".into())
                .await;
            return false;
        }

        if std::fs::symlink_metadata(&from).is_err() {
            self.record_failed(ctx, item, "not_found", "source missing".into())
                .await;
            return false;
        }

        match self.deps.strategy.move_file(&from, &to).await {
            Ok(()) => match self
                .deps
                .catalog
                .mark_media_reverted(item.media_id, &item.old_rel_path)
                .await
            {
                Ok(()) => {
                    self.insert_item(item, None).await;
                    true
                }
                Err(e) => {
                    let message = format!("reverted but catalog update failed: {e}");
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

    /// Records `item`'s revert as `Failed`, and emits a matching
    /// `ItemError` event.
    async fn record_failed(&self, ctx: &JobCtx, item: &OrganizeItemRow, code: &str, message: String) {
        self.insert_item(item, Some(message.clone())).await;
        let _ = ctx
            .events
            .send(JobEvent::ItemError {
                job_id: self.id.clone(),
                path: item.new_rel_path.clone(),
                code: code.to_string(),
                message,
            })
            .await;
    }

    /// Records this revert job's own `organize_items` row: `old_rel_path`
    /// is where the file *was* before this revert (the original item's
    /// `new_rel_path`), `new_rel_path` is where it ended up (the
    /// original item's `old_rel_path`) — mirroring exactly how
    /// `OrganizeJob::insert_item` records a forward move, just with the
    /// two paths swapped. `status` is `Moved` on success, `Failed`
    /// (`error` carrying the message) otherwise.
    async fn insert_item(&self, item: &OrganizeItemRow, error: Option<String>) {
        let status = if error.is_none() {
            PlanStatus::Moved
        } else {
            PlanStatus::Failed
        };
        if let Err(e) = self
            .deps
            .catalog
            .insert_organize_item(&OrganizeItemRow {
                id: 0,
                job_id: self.job_row_id,
                media_id: item.media_id,
                old_rel_path: item.new_rel_path.clone(),
                new_rel_path: item.old_rel_path.clone(),
                status,
                error,
            })
            .await
        {
            tracing::warn!(error = %e, media_id = item.media_id, "failed to record revert item");
        }
    }
}
