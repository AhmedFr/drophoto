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

/// A [`Job`] that reports itself cancelled with a nonzero outcome, as a
/// real job would if it stopped partway through after processing some
/// items — used to prove the runner's `Cancelled` event carries the
/// outcome's real tallies rather than always reporting zeros.
struct CancelledWithProgressJob;

#[async_trait]
impl Job for CancelledWithProgressJob {
    fn id(&self) -> &str {
        "cancelled-with-progress-job"
    }

    async fn run(&self, _ctx: JobCtx) -> DpResult<JobOutcome> {
        Ok(JobOutcome {
            ok: 3,
            failed: 1,
            skipped: 2,
            cancelled: true,
        })
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

#[tokio::test]
async fn cancelled_job_emits_cancelled_with_the_outcomes_real_tallies() {
    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("cancelled");
    runner.spawn(job_id.clone(), Arc::new(CancelledWithProgressJob));

    let terminal = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = rx
                .recv()
                .await
                .expect("channel closed before a terminal event arrived");
            if matches!(ev, JobEvent::Finished { .. } | JobEvent::Cancelled { .. }) {
                return ev;
            }
        }
    })
    .await
    .expect("timed out waiting for the cancelled job to reach a terminal state");

    match terminal {
        JobEvent::Cancelled {
            ok, failed, skipped, ..
        } => {
            assert_eq!(
                (ok, failed, skipped),
                (3, 1, 2),
                "expected Cancelled to carry the outcome's real tallies, not zeros"
            );
        }
        other => panic!("expected Cancelled, got {other:?}"),
    }
}
