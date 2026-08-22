//! Background job infrastructure: a `Job` trait, an async `JobRunner`, and
//! `ScanJob` (drive scanning with progress events).

mod runner;
mod scan;

pub use runner::JobRunner;
pub use scan::{ScanDeps, ScanJob};

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
