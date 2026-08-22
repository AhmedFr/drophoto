use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use dp_core::DpResult;
use dp_jobs::{Job, JobCtx, JobEvent, JobOutcome, JobRunner};
use tokio::sync::mpsc;

/// A [`Job`] whose `run` always panics, used to prove the runner turns a
/// panicking job into a terminal event instead of silently dropping it.
struct PanicJob;

#[async_trait]
impl Job for PanicJob {
    fn id(&self) -> &str {
        "panic-job"
    }

    async fn run(&self, _ctx: JobCtx) -> DpResult<JobOutcome> {
        panic!("boom");
    }
}

#[tokio::test]
async fn panicking_job_emits_item_error_and_finished() {
    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("panic");
    runner.spawn(job_id.clone(), Arc::new(PanicJob));

    let events = tokio::time::timeout(Duration::from_secs(10), async {
        let mut events = Vec::new();
        loop {
            let ev = rx.recv().await.expect("channel closed before Finished");
            let is_terminal = matches!(ev, JobEvent::Finished { .. } | JobEvent::Cancelled { .. });
            events.push(ev);
            if is_terminal {
                return events;
            }
        }
    })
    .await
    .expect("timed out waiting for the panicking job to reach a terminal state");

    assert!(
        matches!(events[0], JobEvent::Started { .. }),
        "events: {events:?}"
    );
    assert!(
        events
            .iter()
            .any(|e| matches!(e, JobEvent::ItemError { code, .. } if code == "panic")),
        "expected an ItemError with code \"panic\", got {events:?}"
    );
    assert!(
        matches!(
            events.last(),
            Some(JobEvent::Finished {
                ok: 0,
                failed: 1,
                skipped: 0,
                ..
            })
        ),
        "expected Finished{{ok:0,failed:1,skipped:0}}, got {events:?}"
    );
    assert!(!runner.is_running(&job_id));
}
