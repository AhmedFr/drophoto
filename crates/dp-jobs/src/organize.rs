//! [`OrganizeJob`]: applies a pre-computed organize plan by moving each
//! `Planned` item into place, recording the outcome of every item in the
//! catalog, and reporting progress along the way.

use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use dp_catalog::Catalog;
use dp_core::{DpError, DpResult, Drive, OrganizeItemRow, OrganizePlanItem, PlanStatus};
use dp_organize::MoveStrategy;

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
    async fn run(&self, ctx: JobCtx) -> DpResult<JobOutcome> {
        let mount_path = match &self.drive.mount_path {
            Some(m) => m.clone(),
            None => {
                let _ = self
                    .deps
                    .catalog
                    .finish_organize_job(self.job_row_id, "failed", 0, 0, 0)
                    .await;
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
                if self.apply_move(&ctx, &mount_path, item).await {
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
        let _ = self
            .deps
            .catalog
            .finish_organize_job(
                self.job_row_id,
                status,
                outcome.ok,
                outcome.skipped,
                outcome.failed,
            )
            .await;

        Ok(outcome)
    }
}

impl OrganizeJob {
    /// Moves one `Planned` item under `mount_path`: on success, marks the
    /// media organized in the catalog and records the item `Moved`; on
    /// failure, records the item `Failed` (with the error message) and
    /// emits an `ItemError` event. Returns whether the move succeeded.
    async fn apply_move(&self, ctx: &JobCtx, mount_path: &str, item: &OrganizePlanItem) -> bool {
        let from = Path::new(mount_path).join(&item.old_rel_path);
        let to = Path::new(mount_path).join(&item.new_rel_path);

        match self.deps.strategy.move_file(&from, &to).await {
            Ok(()) => {
                let _ = self
                    .deps
                    .catalog
                    .mark_media_organized(item.media_id, &item.new_rel_path)
                    .await;
                self.insert_item(item, PlanStatus::Moved, None).await;
                true
            }
            Err(e) => {
                self.insert_item(item, PlanStatus::Failed, Some(e.to_string()))
                    .await;
                let _ = ctx
                    .events
                    .send(JobEvent::ItemError {
                        job_id: self.id.clone(),
                        path: item.old_rel_path.clone(),
                        code: error_code(&e).to_string(),
                        message: e.to_string(),
                    })
                    .await;
                false
            }
        }
    }

    /// Records an already-decided skip (`SkippedDup`/`SkippedCollision`,
    /// or defensively any other non-`Planned` status the caller hands
    /// us) exactly as planned, without touching its file.
    async fn record_as_is(&self, item: &OrganizePlanItem) {
        self.insert_item(item, item.status, item.reason.clone()).await;
    }

    async fn insert_item(&self, item: &OrganizePlanItem, status: PlanStatus, error: Option<String>) {
        let _ = self
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
            .await;
    }
}
