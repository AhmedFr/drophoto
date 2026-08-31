//! [`RevertJob`]: undoes a finished [`crate::OrganizeJob`] by moving every
//! item it actually moved back to its original location, in reverse
//! order, recording the outcome of every item in the catalog.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use async_trait::async_trait;
use dp_core::denylist::is_denied_path;
use dp_core::{DpError, DpResult, Drive, OrganizeItemRow, PlanStatus};
use futures::FutureExt;

use crate::move_guards::{
    destination_stays_on_drive, escapes_mount, mount_online, move_sidecar_along, MOUNT_RECHECK_INTERVAL,
};
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
    /// Items found already reverted by an earlier (partial) attempt —
    /// see [`RevertJob::apply_revert`]'s "already reverted" branch. Kept
    /// separate from `failed` so a retry that finishes off a partial
    /// revert still reads as fully successful.
    skipped: AtomicU64,
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
            skipped: AtomicU64::new(0),
            failed: AtomicU64::new(0),
        }
    }
}

#[async_trait]
impl Job for RevertJob {
    fn id(&self) -> &str {
        &self.id
    }

    fn drive_id(&self) -> Option<i64> {
        Some(self.drive.id)
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

impl RevertJob {
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

            match self.apply_revert(ctx, &mount_path, item).await {
                RevertOutcome::Moved => {
                    self.moved.fetch_add(1, Ordering::Relaxed);
                }
                RevertOutcome::Skipped => {
                    self.skipped.fetch_add(1, Ordering::Relaxed);
                }
                RevertOutcome::Failed => {
                    self.failed.fetch_add(1, Ordering::Relaxed);
                }
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

        let (ok, skipped, failed) = self.totals();
        let outcome = JobOutcome {
            ok,
            failed,
            skipped,
            cancelled,
            // Revert only ever renames files back in place — nothing is
            // read or written byte-for-byte — so these stay 0.
            bytes_read: 0,
            bytes_written: 0,
        };
        // A revert that leaves even one item un-reverted must never read
        // as `"done"` (fully successful) — `reverted_by_job_id` (see
        // `dp_catalog::organize_jobs::REVERTED_BY_SUBQUERY`) treats
        // `"done"` as "this job has been reverted, don't offer it
        // again", and a partial revert is exactly the case where a
        // retry must still be possible. An item found already-reverted
        // (`RevertOutcome::Skipped`) doesn't count against this — a
        // retry that finishes off a prior partial attempt, with every
        // remaining item genuinely moved, must still finish `"done"`.
        let status = if cancelled {
            "cancelled"
        } else if outcome.failed > 0 {
            "failed"
        } else {
            "done"
        };
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

    async fn finish_row(&self, status: &str, moved: u64, skipped: u64, failed: u64) {
        if let Err(e) = self
            .deps
            .catalog
            .finish_organize_job(self.job_row_id, status, moved, skipped, failed)
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
    /// user-controlled paths here as they are on the way in — plus two
    /// revert-specific checks, both run before anything is moved:
    ///
    /// 1. **Identity**: the catalog's current `rel_path` for this media
    ///    must still equal `item.new_rel_path`. An `organize_items` row
    ///    is a *stale snapshot* the moment anything else re-files that
    ///    same photo (a later organize run, an earlier — possibly
    ///    partial — revert) — without this check, replaying that stale
    ///    row would move back whatever now happens to sit at `from`,
    ///    which may not be this photo at all any more.
    ///
    ///    The one exception: if the catalog instead already points at
    ///    `old_rel_path` — this exact item, already reverted — and the
    ///    real file sitting at `to` matches the recorded size, there's
    ///    nothing left to do. That's the ordinary shape of a *retry*
    ///    after a partial revert (some items succeeded, one job row
    ///    later, the same items are handed to a fresh `RevertJob`), and
    ///    it must be recorded [`RevertOutcome::Skipped`] — not `Failed`
    ///    — so a retry that only has already-reverted items left to
    ///    "revert" still finishes `"done"`.
    /// 2. **Size**: the file actually at `from` must be the same size the
    ///    catalog recorded for this media at scan time. Belt-and-braces
    ///    on top of the identity check — `rel_path` can agree while the
    ///    bytes underneath it don't (a same-named file dropped in by
    ///    something else entirely) — cheap enough to always run, unlike
    ///    a full hash.
    ///
    /// `from` must also actually exist, since a missing source can't be
    /// distinguished from "already reverted" any other way (short of the
    /// already-reverted check above) and deserves a clearer message than
    /// whatever `rename` itself would report.
    async fn apply_revert(&self, ctx: &JobCtx, mount_path: &str, item: &OrganizeItemRow) -> RevertOutcome {
        let mount = Path::new(mount_path);
        let from = mount.join(&item.new_rel_path);
        let to = mount.join(&item.old_rel_path);

        if escapes_mount(&item.new_rel_path, &from, mount) || escapes_mount(&item.old_rel_path, &to, mount) {
            self.record_failed(ctx, item, "path", "path escapes the drive root".into())
                .await;
            return RevertOutcome::Failed;
        }

        let home = self.deps.home.as_deref();
        if is_denied_path(&from, mount, home) || is_denied_path(&to, mount, home) {
            self.record_failed(ctx, item, "denied", "path is on the safety deny-list".into())
                .await;
            return RevertOutcome::Failed;
        }

        if !destination_stays_on_drive(&to, mount).await {
            self.record_failed(ctx, item, "path", "destination resolves outside the drive".into())
                .await;
            return RevertOutcome::Failed;
        }

        let media = match self.deps.catalog.get_media_with_drive(item.media_id).await {
            Ok((media, _drive)) => media,
            Err(e) => {
                self.record_failed(ctx, item, error_code(&e), e.to_string()).await;
                return RevertOutcome::Failed;
            }
        };
        if media.rel_path != item.new_rel_path {
            if media.rel_path == item.old_rel_path && file_matches_size(&to, media.size) {
                self.record_skipped_already_reverted(item).await;
                return RevertOutcome::Skipped;
            }
            self.record_failed(ctx, item, "conflict", "media moved since this job".into())
                .await;
            return RevertOutcome::Failed;
        }

        let metadata = match std::fs::symlink_metadata(&from) {
            Ok(m) => m,
            Err(_) => {
                self.record_failed(ctx, item, "not_found", "source missing".into())
                    .await;
                return RevertOutcome::Failed;
            }
        };
        if metadata.len() != media.size {
            self.record_failed(ctx, item, "conflict", "size mismatch".into())
                .await;
            return RevertOutcome::Failed;
        }

        match self.deps.strategy.move_file(&from, &to).await {
            Ok(()) => match self
                .deps
                .catalog
                .mark_media_reverted(item.media_id, &item.old_rel_path)
                .await
            {
                Ok(()) => {
                    self.insert_item(item, PlanStatus::Moved, None).await;
                    move_sidecar_along(
                        ctx,
                        &self.id,
                        &self.deps.catalog,
                        &self.deps.strategy,
                        item.media_id,
                        &from,
                        &to,
                        &item.new_rel_path,
                        &item.old_rel_path,
                        mount,
                    )
                    .await;
                    RevertOutcome::Moved
                }
                Err(e) => {
                    let message = format!("reverted but catalog update failed: {e}");
                    self.record_failed(ctx, item, error_code(&e), message).await;
                    RevertOutcome::Failed
                }
            },
            Err(e) => {
                self.record_failed(ctx, item, error_code(&e), e.to_string()).await;
                RevertOutcome::Failed
            }
        }
    }

    /// Records `item`'s revert as `Failed`, and emits a matching
    /// `ItemError` event.
    async fn record_failed(&self, ctx: &JobCtx, item: &OrganizeItemRow, code: &str, message: String) {
        self.insert_item(item, PlanStatus::Failed, Some(message.clone()))
            .await;
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

    /// Records `item` as `SkippedCollision` with reason "already
    /// reverted" — no `ItemError` event, since this isn't a failure: an
    /// earlier attempt already moved this exact item back.
    async fn record_skipped_already_reverted(&self, item: &OrganizeItemRow) {
        self.insert_item(
            item,
            PlanStatus::SkippedCollision,
            Some("already reverted".into()),
        )
        .await;
    }

    /// Records this revert job's own `organize_items` row: `old_rel_path`
    /// is where the file *was* before this revert (the original item's
    /// `new_rel_path`), `new_rel_path` is where it ended up (the
    /// original item's `old_rel_path`) — mirroring exactly how
    /// `OrganizeJob::insert_item` records a forward move, just with the
    /// two paths swapped.
    async fn insert_item(&self, item: &OrganizeItemRow, status: PlanStatus, error: Option<String>) {
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

/// What [`RevertJob::apply_revert`] actually did with one item.
/// Distinguishing a genuine skip (nothing needed doing — an earlier
/// attempt already reverted it) from a real failure matters both for the
/// item's own `organize_items` row and for this job's aggregate counts:
/// see [`RevertJob::run_inner`]'s status determination.
enum RevertOutcome {
    Moved,
    Skipped,
    Failed,
}

/// Whether `path` exists and its size matches `expected_size` — used by
/// [`RevertJob::apply_revert`] to confirm an "already reverted" item
/// really is sitting at its destination, not just that the catalog says
/// so.
fn file_matches_size(path: &Path, expected_size: u64) -> bool {
    std::fs::symlink_metadata(path)
        .map(|m| m.len() == expected_size)
        .unwrap_or(false)
}
