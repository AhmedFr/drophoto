use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

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
}

impl JobRunner {
    pub fn new(events: mpsc::Sender<JobEvent>) -> Self {
        Self {
            events,
            next_id: AtomicU64::new(0),
            tokens: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Generates the next job id, formatted `"scan-{n}"`.
    pub fn next_id(&self) -> String {
        let n = self.next_id.fetch_add(1, Ordering::SeqCst);
        format!("scan-{n}")
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

        tokio::spawn(async move {
            let _ = events.send(JobEvent::Started { job_id: id.clone() }).await;

            let ctx = JobCtx {
                events: events.clone(),
                cancel: token.clone(),
            };
            let result = job.run(ctx).await;

            lock_tokens(&tokens).remove(&id);

            let final_event = match result {
                Ok(outcome) if outcome.cancelled => JobEvent::Cancelled { job_id: id.clone() },
                Ok(outcome) => JobEvent::Finished {
                    job_id: id.clone(),
                    ok: outcome.ok,
                    failed: outcome.failed,
                    skipped: outcome.skipped,
                },
                Err(_) if token.is_cancelled() => JobEvent::Cancelled { job_id: id.clone() },
                Err(e) => {
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
            };

            let _ = events.send(final_event).await;
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
