//! [`RegenJob`] downscales every cached preview thumbnail (`2000.webp`
//! slot) larger than a target edge, in place — the counterpart to
//! Settings' "lower the preview quality, then regenerate to reclaim
//! space" flow (see `dp_thumbs::ThumbStore::regen_preview`, which does the
//! actual decode/resize/re-encode/atomic-replace work per hash).
//!
//! Like [`crate::GeocodeJob`], this is GLOBAL — one run walks every hash
//! in the thumb store, not scoped to a drive — so `AppState::start_regen`
//! admits it under the same sentinel `drive_id` of `0` convention.
//! Only ever downscales: raising quality back up requires a full rescan
//! with the originals available (a downscaled preview can't be upscaled
//! back to detail that was already thrown away), which this job
//! deliberately does not attempt — see `ThumbStore::regen_preview`'s own
//! "never upscales" guarantee.

use std::sync::Arc;

use async_trait::async_trait;
use dp_core::DpResult;
use dp_thumbs::ThumbStore;

use crate::{error_code, Job, JobCtx, JobEvent, JobOutcome};

/// External dependencies a [`RegenJob`] needs, injected so tests can point
/// it at a temp-dir-backed [`ThumbStore`] instead of the real app-data one.
pub struct RegenDeps {
    pub store: Arc<ThumbStore>,
}

/// A [`Job`] that downscales every cached preview larger than
/// `target_edge` in place. See the module doc comment.
pub struct RegenJob {
    id: String,
    target_edge: u32,
    deps: RegenDeps,
}

impl RegenJob {
    pub fn new(id: String, target_edge: u32, deps: RegenDeps) -> Self {
        Self {
            id,
            target_edge,
            deps,
        }
    }
}

#[async_trait]
impl Job for RegenJob {
    fn id(&self) -> &str {
        &self.id
    }

    // No `drive_id` override — this is a global job, same as `GeocodeJob`
    // (see the module doc comment).

    async fn run(&self, ctx: JobCtx) -> DpResult<JobOutcome> {
        // Best-effort: a process killed mid-rewrite of a previous regen
        // run can leave an orphaned `*.tmp` file behind (see
        // `ThumbStore::regen_preview`'s doc comment) — sweep those before
        // doing anything else so they don't accumulate indefinitely. A
        // sweep failure must never fail the whole job over dead weight
        // it didn't even create.
        if let Err(e) = self.deps.store.sweep_orphaned_tmp().await {
            tracing::warn!(error = %e, job_id = %self.id, "failed to sweep orphaned regen tmp files");
        }

        let hashes = self.deps.store.list_hashes().await?;
        let total = hashes.len() as u64;

        let mut ok = 0u64;
        let mut failed = 0u64;
        let mut skipped = 0u64;
        let mut bytes_read = 0u64;
        let mut bytes_written = 0u64;
        let mut cancelled = false;

        for (index, hash) in hashes.into_iter().enumerate() {
            if ctx.cancel.is_cancelled() {
                cancelled = true;
                break;
            }

            match self.deps.store.regen_preview(&hash, self.target_edge).await {
                Ok(Some((old_bytes, new_bytes))) => {
                    ok += 1;
                    bytes_read += old_bytes;
                    bytes_written += new_bytes;
                }
                Ok(None) => skipped += 1,
                Err(e) => {
                    failed += 1;
                    let _ = ctx
                        .events
                        .send(JobEvent::ItemError {
                            job_id: self.id.clone(),
                            path: hash.clone(),
                            code: error_code(&e).to_string(),
                            message: e.to_string(),
                        })
                        .await;
                }
            }

            let done = index as u64 + 1;
            let _ = ctx
                .events
                .send(JobEvent::Progress {
                    job_id: self.id.clone(),
                    done,
                    total,
                    current: Some(hash),
                })
                .await;
        }

        Ok(JobOutcome {
            ok,
            failed,
            skipped,
            cancelled,
            bytes_read,
            bytes_written,
        })
    }
}
