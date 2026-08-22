use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::{error_code, Job, JobCtx, JobEvent};

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
    /// `Finished` (or `Cancelled`, if [`JobRunner::cancel`] was called for
    /// this id) once it completes.
    pub fn spawn(&self, id: String, job: Arc<dyn Job>) {
        let token = CancellationToken::new();
        self.tokens.lock().unwrap().insert(id.clone(), token.clone());

        let events = self.events.clone();
        let tokens = self.tokens.clone();

        tokio::spawn(async move {
            let _ = events.send(JobEvent::Started { job_id: id.clone() }).await;

            let ctx = JobCtx {
                events: events.clone(),
                cancel: token.clone(),
            };
            let result = job.run(ctx).await;

            let cancelled = token.is_cancelled();
            tokens.lock().unwrap().remove(&id);

            if cancelled {
                let _ = events.send(JobEvent::Cancelled { job_id: id.clone() }).await;
                return;
            }

            match result {
                Ok(outcome) => {
                    let _ = events
                        .send(JobEvent::Finished {
                            job_id: id.clone(),
                            ok: outcome.ok,
                            failed: outcome.failed,
                            skipped: outcome.skipped,
                        })
                        .await;
                }
                Err(e) => {
                    let _ = events
                        .send(JobEvent::ItemError {
                            job_id: id.clone(),
                            path: String::new(),
                            code: error_code(&e).to_string(),
                            message: e.to_string(),
                        })
                        .await;
                    let _ = events
                        .send(JobEvent::Finished {
                            job_id: id.clone(),
                            ok: 0,
                            failed: 1,
                            skipped: 0,
                        })
                        .await;
                }
            }
        });
    }

    /// Requests cancellation of the job running under `job_id`. A no-op if
    /// no such job is currently running.
    pub fn cancel(&self, job_id: &str) {
        if let Some(token) = self.tokens.lock().unwrap().get(job_id) {
            token.cancel();
        }
    }
}
