use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use dp_catalog::{Catalog, SqliteCatalog};
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
            bytes_read: 0,
            bytes_written: 0,
        })
    }
}

/// A [`Job`] that succeeds with fixed tallies and a fixed drive id, used
/// to prove [`JobRunner::with_recorder`] records a [`dp_core::NewJobRun`]
/// with the right kind (parsed from the id prefix), drive id, status, and
/// tallies once the job finishes.
struct RecordedJob;

#[async_trait]
impl Job for RecordedJob {
    fn id(&self) -> &str {
        "scan-42"
    }

    fn drive_id(&self) -> Option<i64> {
        Some(7)
    }

    async fn run(&self, _ctx: JobCtx) -> DpResult<JobOutcome> {
        Ok(JobOutcome {
            ok: 5,
            failed: 1,
            skipped: 2,
            cancelled: false,
            bytes_read: 1000,
            bytes_written: 200,
        })
    }
}

#[tokio::test]
async fn with_recorder_records_a_done_run_with_the_right_kind_drive_id_and_tallies() {
    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx).with_recorder(catalog.clone());
    let job_id = runner.next_id("scan");
    runner.spawn(job_id.clone(), Arc::new(RecordedJob));

    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = rx
                .recv()
                .await
                .expect("channel closed before a terminal event arrived");
            if matches!(ev, JobEvent::Finished { .. } | JobEvent::Cancelled { .. }) {
                return;
            }
        }
    })
    .await
    .expect("timed out waiting for the job to reach a terminal state");

    // Recording happens after the terminal event is sent, so poll briefly
    // rather than assuming it's already landed the instant the event
    // arrives.
    let run = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let runs = catalog.list_job_runs(10).await.unwrap();
            if let Some(run) = runs.into_iter().next() {
                return run;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("timed out waiting for the job run to be recorded");

    assert_eq!(run.job_id, job_id);
    assert_eq!(run.kind, "scan");
    assert_eq!(run.drive_id, Some(7));
    assert_eq!(run.status, "done");
    assert_eq!(run.ok, 5);
    assert_eq!(run.failed, 1);
    assert_eq!(run.skipped, 2);
    assert_eq!(run.bytes_read, 1000);
    assert_eq!(run.bytes_written, 200);
}

#[tokio::test]
async fn with_recorder_records_a_cancelled_run_as_status_cancelled() {
    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx).with_recorder(catalog.clone());
    let job_id = runner.next_id("cancelled");
    runner.spawn(job_id.clone(), Arc::new(CancelledWithProgressJob));

    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let ev = rx
                .recv()
                .await
                .expect("channel closed before a terminal event arrived");
            if matches!(ev, JobEvent::Finished { .. } | JobEvent::Cancelled { .. }) {
                return;
            }
        }
    })
    .await
    .expect("timed out waiting for the job to reach a terminal state");

    let run = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let runs = catalog.list_job_runs(10).await.unwrap();
            if let Some(run) = runs.into_iter().next() {
                return run;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("timed out waiting for the job run to be recorded");

    assert_eq!(run.status, "cancelled");
    assert_eq!(run.kind, "cancelled");
    assert_eq!(run.drive_id, None);
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
