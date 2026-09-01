//! [`SidecarSyncJob`] flushes pending tag changes to XMP sidecars: for
//! every row on a drive flagged `sidecar_pending` (see
//! `dp_catalog::Catalog::list_sidecar_pending`), writes that row's full,
//! current tag set to its media file's XMP sidecar and clears the flag.
//! Any subjects an external app wrote into that sidecar in the meantime
//! are read back and merged into the catalog first, so a sweep never
//! silently erases an edit made outside this app.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use async_trait::async_trait;
use dp_catalog::Catalog;
use dp_core::denylist::is_denied_path;
use dp_core::{DpError, DpResult, Drive, MediaRow};
use dp_metadata::{sidecar_path, Sidecars};
use futures::FutureExt;

use crate::move_guards::destination_stays_on_drive;
use crate::{error_code, tag_sets_match, Job, JobCtx, JobEvent, JobOutcome};

/// External dependencies a [`SidecarSyncJob`] needs, injected so tests can
/// swap in fakes/in-memory implementations.
pub struct SidecarSyncDeps {
    pub catalog: Arc<dyn Catalog>,
    pub sidecars: Arc<dyn Sidecars>,
    /// The current user's home directory (`$HOME`) — see
    /// [`dp_core::denylist::is_denied_path`]'s `home` parameter. `None`
    /// simply skips that one deny-list rule, same as [`crate::ScanDeps`].
    pub home: Option<PathBuf>,
}

/// A [`Job`] that flushes every sidecar-pending row on a drive: writes its
/// current catalog tag names (sorted case-insensitively) to the media
/// file's XMP sidecar via [`Sidecars::write_subjects`], then clears the
/// row's `sidecar_pending` flag.
///
/// Unlike [`crate::OrganizeJob`]/[`crate::RevertJob`], this never creates
/// or closes an `organize_jobs` row — that table is organize/revert-only —
/// so a sidecar sync's progress and outcome are reported purely via
/// [`JobEvent`]s over [`JobCtx::events`], with no catalog-side job record.
pub struct SidecarSyncJob {
    id: String,
    drive: Drive,
    deps: SidecarSyncDeps,
    ok: AtomicU64,
    failed: AtomicU64,
    /// Total bytes written to sidecar files across this run — the size of
    /// each `.xmp` on disk right after a successful
    /// [`Sidecars::write_subjects`] call, summed. See
    /// [`Self::sync_row`].
    bytes_written: AtomicU64,
}

impl SidecarSyncJob {
    pub fn new(id: String, drive: Drive, deps: SidecarSyncDeps) -> Self {
        Self {
            id,
            drive,
            deps,
            ok: AtomicU64::new(0),
            failed: AtomicU64::new(0),
            bytes_written: AtomicU64::new(0),
        }
    }
}

#[async_trait]
impl Job for SidecarSyncJob {
    fn id(&self) -> &str {
        &self.id
    }

    fn drive_id(&self) -> Option<i64> {
        Some(self.drive.id)
    }

    /// Same panic-safety rationale as [`crate::RevertJob::run`]: a panic
    /// partway through still surfaces as a clean `Err`, letting the
    /// runner report it rather than silently dropping the job.
    async fn run(&self, ctx: JobCtx) -> DpResult<JobOutcome> {
        match std::panic::AssertUnwindSafe(self.run_inner(&ctx))
            .catch_unwind()
            .await
        {
            Ok(result) => result,
            Err(_panic) => Err(DpError::Io {
                message: "job panicked".into(),
                path: None,
            }),
        }
    }
}

impl SidecarSyncJob {
    async fn run_inner(&self, ctx: &JobCtx) -> DpResult<JobOutcome> {
        let mount_path = self.drive.mount_path.clone().ok_or_else(|| DpError::NotFound {
            message: "drive is offline".into(),
        })?;
        let mount = std::fs::canonicalize(&mount_path).map_err(|e| DpError::Io {
            message: format!("failed to canonicalize mount path: {e}"),
            path: Some(mount_path.clone()),
        })?;

        // Tagging is bursty: the user selects a dozen photos, tags them,
        // and keeps going while this sweep runs. A single
        // `list_sidecar_pending` snapshot would leave everything tagged
        // after it was taken sitting unwritten until *something else*
        // happened to start another sweep, so instead we re-fetch until
        // nothing new turns up.
        //
        // `attempted` is what keeps that from spinning forever: a row
        // whose sync failed deliberately keeps its `sidecar_pending`
        // flag (so a *later* sweep retries it), which means it comes
        // straight back in the next fetch. Filtering out ids already
        // tried in this run means a permanently-failing row ends the
        // loop instead of restarting it, and is tallied exactly once.
        let mut attempted: HashSet<i64> = HashSet::new();
        let mut done = 0u64;
        let mut cancelled = false;

        'sweep: loop {
            if ctx.cancel.is_cancelled() {
                cancelled = true;
                break;
            }

            let rows: Vec<MediaRow> = self
                .deps
                .catalog
                .list_sidecar_pending(self.drive.id)
                .await?
                .into_iter()
                .filter(|row| !attempted.contains(&row.id))
                .collect();
            if rows.is_empty() {
                break;
            }

            let total = done + rows.len() as u64;
            for row in &rows {
                if ctx.cancel.is_cancelled() {
                    cancelled = true;
                    break 'sweep;
                }

                attempted.insert(row.id);
                self.sync_row(ctx, &mount, row).await;

                done += 1;
                ctx.progress(&self.id, done, total, Some(row.rel_path.clone()))
                    .await;
            }
        }

        let (ok, failed) = self.totals();
        Ok(JobOutcome {
            ok,
            failed,
            skipped: 0,
            cancelled,
            // Sidecar sync only writes, never reads a file's bytes.
            bytes_read: 0,
            bytes_written: self.bytes_written.load(Ordering::Relaxed),
        })
    }

    /// The `(ok, failed)` tallies applied so far.
    fn totals(&self) -> (u64, u64) {
        (
            self.ok.load(Ordering::Relaxed),
            self.failed.load(Ordering::Relaxed),
        )
    }

    /// Syncs one pending row: resolves its absolute path under `mount`,
    /// deny-checks both it and its sidecar path (same
    /// [`is_denied_path`] shape [`crate::ScanJob::run`] uses — a
    /// canonicalized `mount`, this call's `home`), confirms the file still
    /// exists, then — the same symlink-resolution guard
    /// [`crate::OrganizeJob`]/[`crate::RevertJob`] apply to every move
    /// destination — confirms the sidecar's path still really resolves
    /// under `mount` once symlinks are followed, before ever writing to
    /// it. Only then does it write the row's tag names — merged with any
    /// external sidecar edit, see [`Self::merged_names`] — to the sidecar
    /// and clear the pending flag (see [`Self::finish_row`] for the
    /// lost-update check that guards that last step). Any failure
    /// along the way is recorded via [`Self::record_failed`] and leaves
    /// the row's `sidecar_pending` flag untouched, so a later sync
    /// retries it.
    async fn sync_row(&self, ctx: &JobCtx, mount: &Path, row: &MediaRow) {
        let abs = mount.join(&row.rel_path);
        let sidecar = sidecar_path(&abs);
        let home = self.deps.home.as_deref();

        if is_denied_path(&abs, mount, home) || is_denied_path(&sidecar, mount, home) {
            self.record_failed(ctx, row, "denied", "path is on the safety deny-list".into())
                .await;
            return;
        }

        if std::fs::symlink_metadata(&abs).is_err() {
            self.record_failed(ctx, row, "not_found", "file is missing".into())
                .await;
            return;
        }

        if !destination_stays_on_drive(&sidecar, mount).await {
            self.record_failed(
                ctx,
                row,
                "denied",
                "sidecar path resolves outside the drive".into(),
            )
            .await;
            return;
        }

        let mut names = match self.merged_names(ctx, &abs, row).await {
            Some(names) => names,
            None => return,
        };
        names.sort_by_key(|n| n.to_lowercase());

        if let Err(e) = self.deps.sidecars.write_subjects(&abs, &names).await {
            self.record_failed(ctx, row, error_code(&e), e.to_string()).await;
            return;
        }

        // `Sidecars::write_subjects` reports success/failure only, not
        // the bytes it wrote — the sidecar's size is read back off disk
        // right after the write instead. A failure to stat it (rare: the
        // write above just succeeded) simply skips the tally rather than
        // failing an otherwise-successful sync.
        //
        // This write is also exactly the case that makes
        // `ScanIndexEntry::sidecar_mtime` matter: it's this job that
        // creates/touches the `.xmp`, which would otherwise look
        // perpetually "newer" than a media row that never recorded a
        // baseline — see `dp_jobs::scan::maybe_import_newer_sidecar` —
        // and get a wasted exiftool re-read on every single incremental
        // scan forever. Recording the mtime here is what lets that skip
        // path converge instead.
        if let Ok(meta) = tokio::fs::metadata(&sidecar).await {
            self.bytes_written.fetch_add(meta.len(), Ordering::Relaxed);
            if let Ok(mtime) = meta.modified() {
                if let Err(e) = self.deps.catalog.set_sidecar_mtime(row.id, mtime.into()).await {
                    tracing::warn!(media_id = row.id, error = %e, "failed to record sidecar mtime after sync write");
                }
            }
        }

        self.finish_row(ctx, row, &names).await;
    }

    /// The tag names to write for `row`, after folding any *external*
    /// sidecar edit back into the catalog.
    ///
    /// A row can sit flagged `sidecar_pending` for a while, and in that
    /// window another app — Lightroom, Bridge, a text editor — can write
    /// subjects straight into the `.xmp`. Writing the catalog's tag set
    /// blind would erase that edit with no trace, so this reads the
    /// sidecar first, and any subject the catalog doesn't already have
    /// (compared case-insensitively, same as everywhere else tags are
    /// matched) is `tag_media`'d *into* the catalog before the fresh,
    /// merged set is re-fetched and returned. The external edit is
    /// imported rather than lost.
    ///
    /// The merge is deliberately a union, not a reconciliation: a tag the
    /// catalog holds but the sidecar no longer does is re-added to the
    /// sidecar rather than removed from the catalog. Deletions are the
    /// one direction where catalog wins, because a sidecar with a tag
    /// missing is indistinguishable from a sidecar written before that
    /// tag was ever added — and re-adding a tag someone deleted elsewhere
    /// is a far smaller loss than dropping tags this app was told to add.
    /// The documented trade-off: a tag deleted in another app, on a row
    /// that's still pending here, comes back.
    ///
    /// Returns `None` when something failed (already recorded via
    /// [`Self::record_failed`]) and the row should be abandoned.
    async fn merged_names(&self, ctx: &JobCtx, abs: &Path, row: &MediaRow) -> Option<Vec<String>> {
        let names = match self.deps.catalog.tag_names_for_media(row.id).await {
            Ok(names) => names,
            Err(e) => {
                self.record_failed(ctx, row, error_code(&e), e.to_string()).await;
                return None;
            }
        };

        // A sidecar that exists but can't be parsed (corrupt, truncated,
        // hand-edited into invalid XML) is treated as having no external
        // subjects rather than failing the row: before the merge existed,
        // such a file was simply overwritten with catalog truth — the one
        // way it heals. Failing here would instead leave the row pending
        // forever, erroring on every sweep.
        let subjects = match self.deps.sidecars.read_subjects(abs).await {
            Ok(subjects) => subjects,
            Err(e) => {
                tracing::warn!(
                    "unreadable sidecar for {} — overwriting with catalog tags: {e}",
                    row.rel_path
                );
                Vec::new()
            }
        };

        let known: HashSet<String> = names.iter().map(|n| n.to_lowercase()).collect();
        let external: Vec<String> = subjects
            .into_iter()
            .filter(|s| !known.contains(&s.to_lowercase()))
            .collect();
        if external.is_empty() {
            return Some(names);
        }

        if let Err(e) = self.deps.catalog.tag_media(&[row.id], &external, &[]).await {
            self.record_failed(ctx, row, error_code(&e), e.to_string()).await;
            return None;
        }

        match self.deps.catalog.tag_names_for_media(row.id).await {
            Ok(names) => Some(names),
            Err(e) => {
                self.record_failed(ctx, row, error_code(&e), e.to_string()).await;
                None
            }
        }
    }

    /// After a successful [`Sidecars::write_subjects`], re-fetches the
    /// row's tag names and only clears `sidecar_pending` if they still
    /// match `written` (case-insensitively, as sets) — i.e. nothing
    /// re-tagged this row while the write was in flight. If they've
    /// diverged, the flag is deliberately left set: clearing it here
    /// would lose that concurrent change, silently leaving the sidecar
    /// out of sync until something *else* happened to mark the row
    /// pending again. Leaving it set costs nothing but a redundant write
    /// on the next sweep, which does catch it.
    ///
    /// A failure fetching the fresh tag names is treated the same as any
    /// other failure here: recorded, flag left set. The sidecar itself
    /// was already written by this point and is not rolled back — same
    /// data-safety stance as [`crate::OrganizeJob`]/[`crate::RevertJob`]
    /// never undoing a real filesystem change after the fact.
    async fn finish_row(&self, ctx: &JobCtx, row: &MediaRow, written: &[String]) {
        let fresh = match self.deps.catalog.tag_names_for_media(row.id).await {
            Ok(names) => names,
            Err(e) => {
                self.record_failed(ctx, row, error_code(&e), e.to_string()).await;
                return;
            }
        };

        if !tag_sets_match(&fresh, written) {
            // Lost-update: something changed this row's tags after
            // `write_subjects` read them. Leave `sidecar_pending` set so
            // the next sweep picks up the now-current tag set.
            return;
        }

        if let Err(e) = self.deps.catalog.clear_sidecar_pending(row.id).await {
            self.record_failed(ctx, row, error_code(&e), e.to_string()).await;
            return;
        }

        self.ok.fetch_add(1, Ordering::Relaxed);
    }

    /// Records one row's sync as failed: bumps the tally and emits a
    /// matching `ItemError` event. The row's `sidecar_pending` flag is
    /// simply never cleared — there's no catalog-side job record for a
    /// sidecar sync to update (see [`SidecarSyncJob`]'s doc comment).
    async fn record_failed(&self, ctx: &JobCtx, row: &MediaRow, code: &str, message: String) {
        self.failed.fetch_add(1, Ordering::Relaxed);
        let _ = ctx
            .events
            .send(JobEvent::ItemError {
                job_id: self.id.clone(),
                path: row.rel_path.clone(),
                code: code.to_string(),
                message,
            })
            .await;
    }
}
