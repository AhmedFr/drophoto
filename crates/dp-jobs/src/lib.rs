//! Background job infrastructure: a `Job` trait, an async `JobRunner`, and
//! `ScanJob` (drive scanning with progress events).

pub mod detect;
mod geocode;
mod move_guards;
mod organize;
mod prune;
mod revert;
mod runner;
mod scan;
mod sidecar_sync;

pub use detect::{detect_folders, detect_folders_with_progress};
pub use geocode::{GeocodeDeps, GeocodeJob};
pub use organize::{OrganizeDeps, OrganizeJob};
pub use prune::prune_denied_legacy_rows;
pub use revert::RevertJob;
pub use runner::JobRunner;
pub use scan::{ScanDeps, ScanJob};
pub use sidecar_sync::{SidecarSyncDeps, SidecarSyncJob};

use async_trait::async_trait;
use dp_core::{DpError, DpResult};
use serde::Serialize;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// Events emitted by a running [`Job`] over its [`JobCtx::events`] channel.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum JobEvent {
    Started {
        job_id: String,
    },
    Progress {
        job_id: String,
        done: u64,
        total: u64,
        current: Option<String>,
    },
    ItemError {
        job_id: String,
        path: String,
        code: String,
        message: String,
    },
    Finished {
        job_id: String,
        ok: u64,
        failed: u64,
        skipped: u64,
    },
    Cancelled {
        job_id: String,
        ok: u64,
        failed: u64,
        skipped: u64,
    },
}

/// Per-file (or per-item) outcome counters returned by [`Job::run`].
///
/// `cancelled` should be set `true` by a `Job` implementation that stopped
/// early because [`JobCtx::cancel`] was triggered, so the runner can
/// distinguish "finished, cancellation arrived too late to matter" from
/// "actually stopped early due to cancellation" without relying on the
/// token's state *after* `run` has already returned (which races against a
/// cancel request arriving right as the job finishes on its own).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct JobOutcome {
    pub ok: u64,
    pub failed: u64,
    pub skipped: u64,
    pub cancelled: bool,
    /// Bytes read from source files during this run (scan: file size per
    /// hashed file). `0` for job kinds that don't read file bytes
    /// (organize/revert only rename; sidecar sync writes, doesn't read;
    /// geocode touches no files).
    pub bytes_read: u64,
    /// Bytes written during this run (scan: rendered thumbnail sizes;
    /// sidecar sync: written sidecar file size). `0` for organize/revert
    /// (renames) and geocode (no files touched).
    pub bytes_written: u64,
}

/// Shared context handed to a [`Job`] when it runs: where to send events,
/// and a token to check for cancellation.
#[derive(Clone)]
pub struct JobCtx {
    pub events: mpsc::Sender<JobEvent>,
    pub cancel: CancellationToken,
}

/// A unit of background work run by a [`JobRunner`].
#[async_trait]
pub trait Job: Send + Sync {
    fn id(&self) -> &str;
    /// The drive this job runs against, for [`JobRunner`]'s job-run
    /// metrics recording (`NewJobRun::drive_id`). `None` by default —
    /// every per-drive job overrides it with `Some(self.drive.id)`;
    /// [`GeocodeJob`] (a global sweep, not scoped to any one drive) keeps
    /// the default.
    fn drive_id(&self) -> Option<i64> {
        None
    }
    async fn run(&self, ctx: JobCtx) -> DpResult<JobOutcome>;
}

/// Maps a [`DpError`] to the stable, snake_case code string used in
/// [`JobEvent::ItemError`] and `Catalog::record_scan_error`.
pub(crate) fn error_code(e: &DpError) -> &'static str {
    match e {
        DpError::Io { .. } => "io",
        DpError::NotFound { .. } => "not_found",
        DpError::Sidecar { .. } => "sidecar",
        DpError::Db { .. } => "db",
        DpError::Unsupported { .. } => "unsupported",
    }
}

/// Whether `a` and `b` contain the same names, ignoring order, duplicates,
/// and case. Shared by `sidecar_sync.rs` (detecting a lost update between
/// reading a row's tags and its sidecar write completing) and `scan.rs`
/// (deciding whether a row's catalog tag set now exactly mirrors what was
/// just imported from its sidecar) — kept in one place so the two call
/// sites can't drift on what "same tag set" means.
pub(crate) fn tag_sets_match(a: &[String], b: &[String]) -> bool {
    let a: std::collections::HashSet<String> = a.iter().map(|s| s.to_lowercase()).collect();
    let b: std::collections::HashSet<String> = b.iter().map(|s| s.to_lowercase()).collect();
    a == b
}
