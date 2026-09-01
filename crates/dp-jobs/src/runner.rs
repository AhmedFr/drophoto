use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use chrono::Utc;
use dp_catalog::Catalog;
use dp_core::NewJobRun;
use futures::FutureExt;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::{error_code, Job, JobCtx, JobEvent};

/// Locks `tokens`, recovering from mutex poisoning instead of unwrapping.
/// The critical sections guarded by this lock are trivial `HashMap`
/// insert/remove/get calls, so a panic mid-section can't leave the map in
/// a state worth propagating a poisoned-lock panic for.
fn lock_tokens(
    tokens: &Mutex<HashMap<String, CancellationToken>>,
) -> MutexGuard<'_, HashMap<String, CancellationToken>> {
    tokens.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Spawns [`Job`]s as tokio tasks, tracking a [`CancellationToken`] per
/// running job so callers can request cancellation by id.
///
/// `Send + Sync` so it can live in shared (e.g. Tauri) app state.
pub struct JobRunner {
    events: mpsc::Sender<JobEvent>,
    next_id: AtomicU64,
    tokens: Arc<Mutex<HashMap<String, CancellationToken>>>,
    /// When set, every job's terminal outcome is recorded as a
    /// [`NewJobRun`] via [`Catalog::record_job_run`] — see
    /// [`Self::with_recorder`]. `None` (the default) simply skips
    /// recording, which is what every test double / non-Tauri caller
    /// gets unless it opts in.
    recorder: Option<Arc<dyn Catalog>>,
}

impl JobRunner {
    pub fn new(events: mpsc::Sender<JobEvent>) -> Self {
        Self {
            events,
            next_id: AtomicU64::new(0),
            tokens: Arc::new(Mutex::new(HashMap::new())),
            recorder: None,
        }
    }

    /// Enables per-job run metrics: every job's terminal outcome is
    /// recorded to `catalog` via [`Catalog::record_job_run`] once it
    /// finishes. Builder-style, meant to be chained onto [`Self::new`]
    /// at startup.
    pub fn with_recorder(mut self, catalog: Arc<dyn Catalog>) -> Self {
        self.recorder = Some(catalog);
        self
    }

    /// Generates the next job id, formatted `"{prefix}-{n}"`.
    pub fn next_id(&self, prefix: &str) -> String {
        let n = self.next_id.fetch_add(1, Ordering::SeqCst);
        format!("{prefix}-{n}")
    }

    /// Whether a job is currently running under `job_id` (i.e. its
    /// cancellation token is still tracked).
    pub fn is_running(&self, job_id: &str) -> bool {
        lock_tokens(&self.tokens).contains_key(job_id)
    }

    /// Spawns `job` under `id`, emitting `Started` immediately and then
    /// `Finished` or `Cancelled` once it completes.
    ///
    /// The terminal event is decided from the job's own [`JobOutcome`]
    /// where possible (`outcome.cancelled`), rather than re-checking the
    /// cancellation token after the fact: checking the token post-hoc would
    /// race against a cancel request arriving just after the job finished
    /// normally, discarding real counts in favor of a spurious `Cancelled`.
    /// The token is only consulted directly in the `Err` path, where there
    /// is no `JobOutcome` to carry the flag.
    pub fn spawn(&self, id: String, job: Arc<dyn Job>) {
        let token = CancellationToken::new();
        lock_tokens(&self.tokens).insert(id.clone(), token.clone());

        let events = self.events.clone();
        let tokens = self.tokens.clone();
        let recorder = self.recorder.clone();

        tokio::spawn(async move {
            let _ = events.send(JobEvent::Started { job_id: id.clone() }).await;

            let started_at = Utc::now();
            let cpu_before = process_cpu_ms();
            let drive_id = job.drive_id();

            let ctx = JobCtx::new(events.clone(), token.clone());
            let outcome = std::panic::AssertUnwindSafe(job.run(ctx)).catch_unwind().await;

            lock_tokens(&tokens).remove(&id);

            // Status/tallies for the `job_runs` record — a plain
            // simplification of the event-shape decided just below:
            // "cancelled" only ever comes from a `JobOutcome` that says so
            // itself; anything that came back `Err` or panicked (even one
            // that raced a cancel request, reported to the UI as
            // `Cancelled` below) is recorded `"failed"`, since there's no
            // real `JobOutcome` in that path to know the true tallies —
            // recording zeros there rather than guessing.
            let record_status: &'static str;
            let (record_ok, record_failed, record_skipped, record_bytes_read, record_bytes_written) =
                match &outcome {
                    Ok(Ok(outcome)) if outcome.cancelled => {
                        record_status = "cancelled";
                        (
                            outcome.ok,
                            outcome.failed,
                            outcome.skipped,
                            outcome.bytes_read,
                            outcome.bytes_written,
                        )
                    }
                    Ok(Ok(outcome)) => {
                        record_status = "done";
                        (
                            outcome.ok,
                            outcome.failed,
                            outcome.skipped,
                            outcome.bytes_read,
                            outcome.bytes_written,
                        )
                    }
                    _ => {
                        record_status = "failed";
                        (0, 0, 0, 0, 0)
                    }
                };

            let final_event = match outcome {
                Ok(Ok(outcome)) if outcome.cancelled => JobEvent::Cancelled {
                    job_id: id.clone(),
                    ok: outcome.ok,
                    failed: outcome.failed,
                    skipped: outcome.skipped,
                },
                Ok(Ok(outcome)) => JobEvent::Finished {
                    job_id: id.clone(),
                    ok: outcome.ok,
                    failed: outcome.failed,
                    skipped: outcome.skipped,
                },
                Ok(Err(_)) if token.is_cancelled() => JobEvent::Cancelled {
                    job_id: id.clone(),
                    ok: 0,
                    failed: 0,
                    skipped: 0,
                },
                Ok(Err(e)) => {
                    let _ = events
                        .send(JobEvent::ItemError {
                            job_id: id.clone(),
                            path: String::new(),
                            code: error_code(&e).to_string(),
                            message: e.to_string(),
                        })
                        .await;
                    JobEvent::Finished {
                        job_id: id.clone(),
                        ok: 0,
                        failed: 1,
                        skipped: 0,
                    }
                }
                Err(panic) => {
                    let message = panic_message(&panic);
                    let _ = events
                        .send(JobEvent::ItemError {
                            job_id: id.clone(),
                            path: String::new(),
                            code: "panic".to_string(),
                            message,
                        })
                        .await;
                    JobEvent::Finished {
                        job_id: id.clone(),
                        ok: 0,
                        failed: 1,
                        skipped: 0,
                    }
                }
            };

            let _ = events.send(final_event).await;

            if let Some(catalog) = recorder {
                let kind = id.split('-').next().unwrap_or(&id).to_string();
                let cpu_ms = process_cpu_ms().saturating_sub(cpu_before);
                let run = NewJobRun {
                    job_id: id.clone(),
                    kind,
                    drive_id,
                    status: record_status.to_string(),
                    ok: record_ok,
                    failed: record_failed,
                    skipped: record_skipped,
                    bytes_read: record_bytes_read,
                    bytes_written: record_bytes_written,
                    cpu_ms,
                    started_at,
                    finished_at: Utc::now(),
                };
                if let Err(e) = catalog.record_job_run(run).await {
                    tracing::warn!(error = %e, job_id = %id, "failed to record job run metrics");
                }
            }
        });
    }

    /// Requests cancellation of the job running under `job_id`. A no-op if
    /// no such job is currently running.
    pub fn cancel(&self, job_id: &str) {
        if let Some(token) = lock_tokens(&self.tokens).get(job_id) {
            token.cancel();
        }
    }
}

/// Process-wide CPU time consumed so far (user + sys), in milliseconds, via
/// `getrusage(RUSAGE_SELF)`. [`JobRunner::spawn`] samples this before and
/// after a job runs and records the delta as `NewJobRun::cpu_ms` —
/// deliberately process-wide rather than an isolated per-job measurement
/// (there's no cheap per-task CPU accounting available here), so it's
/// documented on [`dp_core::NewJobRun::cpu_ms`] as "app CPU during this
/// job, including concurrent jobs" rather than claiming false precision.
fn process_cpu_ms() -> u64 {
    // SAFETY: `usage` is a plain-old-data struct we zero-initialize
    // ourselves, and `RUSAGE_SELF` is a valid, constant resource selector.
    // `getrusage` only ever writes through the pointer it's given — it
    // never reads from `usage` first — so starting from a zeroed value is
    // sound, and the call itself has no other preconditions on this
    // platform.
    let usage: libc::rusage = unsafe {
        let mut usage: libc::rusage = std::mem::zeroed();
        libc::getrusage(libc::RUSAGE_SELF, &mut usage);
        usage
    };
    let user_ms = (usage.ru_utime.tv_sec as u64) * 1000 + (usage.ru_utime.tv_usec as u64) / 1000;
    let sys_ms = (usage.ru_stime.tv_sec as u64) * 1000 + (usage.ru_stime.tv_usec as u64) / 1000;
    user_ms + sys_ms
}

/// Extracts a human-readable message from a caught panic payload, falling
/// back to a generic message when the payload isn't a `&str`/`String` (the
/// common case for `panic!("...")` and friends).
fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        s.to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "job panicked".to_string()
    }
}
