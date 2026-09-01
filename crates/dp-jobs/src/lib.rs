//! Background job infrastructure: a `Job` trait, an async `JobRunner`, and
//! `ScanJob` (drive scanning with progress events).

pub mod detect;
mod geocode;
mod move_guards;
mod organize;
mod prune;
mod regen;
mod revert;
mod runner;
mod scan;
mod sidecar_sync;

pub use detect::{detect_folders, detect_folders_with_progress};
pub use geocode::{GeocodeDeps, GeocodeJob};
pub use organize::{OrganizeDeps, OrganizeJob};
pub use prune::prune_denied_legacy_rows;
pub use regen::{RegenDeps, RegenJob};
pub use revert::RevertJob;
pub use runner::JobRunner;
pub use scan::{ScanDeps, ScanJob};
pub use sidecar_sync::{SidecarSyncDeps, SidecarSyncJob};

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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

/// Minimum spacing between consecutive `Progress` events sent through
/// [`JobCtx::progress`]/[`JobCtx::progress_blocking`]. A scan can call
/// these hundreds of times a second (once per file); every subscriber of
/// the event channel — the Zustand store, and everything it re-renders —
/// pays for each one, so item-level progress is coalesced down to this
/// cadence at the source, the one place every job routes it through.
const PROGRESS_COALESCE_INTERVAL: Duration = Duration::from_millis(100);

/// Per-job gate deciding whether a `Progress` event should actually go out
/// right now. Always lets through: the very first progress tick of a job
/// (`last_emit` still `None`), and the tick where `done` reaches a known
/// nonzero `total` — so a job that runs to completion always emits its
/// final, most up-to-date count. Everything else is allowed at most once
/// per [`PROGRESS_COALESCE_INTERVAL`], and a suppressed tick is simply
/// dropped rather than queued for later — this is a pure rate gate, not a
/// trailing flush. A job that ends *without* reaching `total` (e.g.
/// cancellation) can therefore lose its last displayed `Progress` count to
/// this gate; nothing user-visible is lost by it, since the job's terminal
/// event (`Finished`/`Cancelled`) always carries its own authoritative
/// final tallies and the UI switches to that readout immediately.
///
/// Shared (via `Arc`) across every clone of the [`JobCtx`] a single job
/// run hands out — including the ones cloned per concurrently-processed
/// item — so the gate reflects that job's cadence as a whole, not each
/// clone's own view of time.
#[derive(Default)]
struct ProgressGate {
    last_emit: Mutex<Option<Instant>>,
}

impl ProgressGate {
    fn should_emit(&self, done: u64, total: u64) -> bool {
        let is_final = total > 0 && done >= total;
        let mut last = self
            .last_emit
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = Instant::now();
        let emit = is_final
            || match *last {
                None => true,
                Some(t) => now.duration_since(t) >= PROGRESS_COALESCE_INTERVAL,
            };
        if emit {
            *last = Some(now);
        }
        emit
    }
}

/// Shared context handed to a [`Job`] when it runs: where to send events,
/// and a token to check for cancellation.
#[derive(Clone)]
pub struct JobCtx {
    pub events: mpsc::Sender<JobEvent>,
    pub cancel: CancellationToken,
    /// Coalescing state for [`Self::progress`]/[`Self::progress_blocking`]
    /// — private, constructed fresh by [`Self::new`] so every job run
    /// starts its own gate.
    progress_gate: Arc<ProgressGate>,
}

impl JobCtx {
    /// Builds a fresh `JobCtx` — the only way to construct one outside
    /// this crate, since [`Self::progress_gate`] is private. Every job run
    /// gets its own gate: cloning an existing `JobCtx` (as happens once
    /// per concurrently-processed item) shares that gate, but two
    /// unrelated `JobCtx::new` calls never do.
    pub fn new(events: mpsc::Sender<JobEvent>, cancel: CancellationToken) -> Self {
        Self {
            events,
            cancel,
            progress_gate: Arc::new(ProgressGate::default()),
        }
    }

    /// Sends a `JobEvent::Progress { job_id, done, total, current }`,
    /// coalesced through this job's [`ProgressGate`] (see its doc comment
    /// for exactly what always gets through). This is the single place
    /// every job in this crate should route its per-item progress through,
    /// so the coalescing behavior lives in exactly one place rather than
    /// being reimplemented per job.
    pub async fn progress(&self, job_id: &str, done: u64, total: u64, current: Option<String>) {
        if self.progress_gate.should_emit(done, total) {
            let _ = self
                .events
                .send(JobEvent::Progress {
                    job_id: job_id.to_string(),
                    done,
                    total,
                    current,
                })
                .await;
        }
    }

    /// Synchronous counterpart to [`Self::progress`], for callers running
    /// outside the async runtime — e.g. the scan's directory walk, which
    /// runs inside `spawn_blocking`. Shares the same gate as `progress`,
    /// via `Sender::blocking_send` instead of `send`.
    pub fn progress_blocking(&self, job_id: &str, done: u64, total: u64, current: Option<String>) {
        if self.progress_gate.should_emit(done, total) {
            let _ = self.events.blocking_send(JobEvent::Progress {
                job_id: job_id.to_string(),
                done,
                total,
                current,
            });
        }
    }
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
