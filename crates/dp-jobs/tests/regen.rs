use std::sync::Arc;

use dp_jobs::{JobEvent, JobRunner, RegenDeps, RegenJob};
use dp_thumbs::ThumbStore;
use tokio::sync::mpsc;

fn img(edge: u32) -> image::RgbImage {
    image::RgbImage::from_pixel(edge, edge, image::Rgb([120, 60, 30]))
}

async fn drain_until_terminal(rx: &mut mpsc::Receiver<JobEvent>) -> (Vec<JobEvent>, JobEvent) {
    let mut events = Vec::new();
    loop {
        let ev = rx.recv().await.expect("channel closed before a terminal event");
        let is_terminal = matches!(ev, JobEvent::Finished { .. } | JobEvent::Cancelled { .. });
        events.push(ev.clone());
        if is_terminal {
            return (events, ev);
        }
    }
}

/// Real-filesystem test: three cached previews (two above the target
/// edge, one already below it), plus a 400px thumb slot alongside one of
/// them. After a run, the larger previews are downscaled in place (byte
/// sizes shrink and the decoded edge matches the target), the
/// already-small one is left untouched, and the 400px thumb is never
/// touched.
#[tokio::test]
async fn regen_job_downscales_larger_previews_leaves_small_ones_and_thumbs_alone() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(dir.path()));

    store.write("big-1", 2000, &img(2000)).await.unwrap();
    store.write("big-2", 2000, &img(1600)).await.unwrap();
    store.write("small", 2000, &img(400)).await.unwrap();
    store.write("big-1", 400, &img(400)).await.unwrap();

    let big1_before = std::fs::metadata(store.path("big-1", 2000)).unwrap().len();
    let big2_before = std::fs::metadata(store.path("big-2", 2000)).unwrap().len();
    let small_before = std::fs::metadata(store.path("small", 2000)).unwrap().len();
    let thumb_before = std::fs::metadata(store.path("big-1", 400)).unwrap().len();

    let deps = RegenDeps { store: store.clone() };
    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("regen");
    let job = Arc::new(RegenJob::new(job_id.clone(), 800, deps));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!(ok, 2, "big-1 and big-2 should have been downscaled: {events:?}");
    assert_eq!(failed, 0, "events: {events:?}");
    assert_eq!(
        skipped, 1,
        "the already-small preview should be skipped: {events:?}"
    );

    let big1_after = std::fs::metadata(store.path("big-1", 2000)).unwrap().len();
    let big2_after = std::fs::metadata(store.path("big-2", 2000)).unwrap().len();
    let small_after = std::fs::metadata(store.path("small", 2000)).unwrap().len();
    let thumb_after = std::fs::metadata(store.path("big-1", 400)).unwrap().len();

    assert!(big1_after < big1_before, "big-1 preview should have shrunk");
    assert!(big2_after < big2_before, "big-2 preview should have shrunk");
    assert_eq!(
        small_after, small_before,
        "an already-small preview must be untouched"
    );
    assert_eq!(
        thumb_after, thumb_before,
        "the 400px thumb slot must never be touched"
    );

    let decoded = image::open(store.path("big-1", 2000)).unwrap().to_rgb8();
    assert_eq!(decoded.width().max(decoded.height()), 800);
}

#[tokio::test]
async fn regen_job_reports_zero_totals_when_the_store_is_empty() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(ThumbStore::new(dir.path()));
    let deps = RegenDeps { store };

    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("regen");
    let job = Arc::new(RegenJob::new(job_id.clone(), 800, deps));
    runner.spawn(job_id, job);

    let (_events, terminal) = drain_until_terminal(&mut rx).await;
    assert!(matches!(
        terminal,
        JobEvent::Finished {
            ok: 0,
            failed: 0,
            skipped: 0,
            ..
        }
    ));
}
