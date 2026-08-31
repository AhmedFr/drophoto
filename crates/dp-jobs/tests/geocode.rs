use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, MediaKind, NewDrive, NewMedia, NewPlace, PlaceSource};
use dp_jobs::{GeocodeDeps, GeocodeJob, Job, JobCtx, JobEvent, JobRunner};
use dp_places::{City, Geocoder};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

fn nm(drive_id: i64, rel_path: &str, hash: &str, lat: Option<f64>, lon: Option<f64>) -> NewMedia {
    NewMedia {
        drive_id,
        rel_path: rel_path.into(),
        hash: hash.into(),
        size: 9,
        kind: MediaKind::Photo,
        ext: "jpg".into(),
        width: None,
        height: None,
        duration_ms: None,
        taken_at: None,
        camera: None,
        lens: None,
        aperture: None,
        shutter: None,
        iso: None,
        focal_mm: None,
        lat,
        lon,
        organized_at: None,
        mtime: None,
        source_id: None,
    }
}

async fn drive(catalog: &Arc<dyn Catalog>) -> i64 {
    catalog
        .register_drive(NewDrive {
            name: "Geocode Drive".into(),
            mount_path: "/Volumes/Geocode".into(),
            role: DriveRole::Archive,
            capacity: 100,
            free: 40,
        })
        .await
        .unwrap()
        .id
}

fn lisbon() -> City {
    City {
        name: "Lisbon".into(),
        admin: Some("Lisboa".into()),
        country: "Portugal".into(),
        lat: 38.7223,
        lon: -9.1393,
    }
}

/// A deterministic, single-city [`Geocoder`] fake: `reverse` treats degree
/// distance from `city` as km at a flat 111 km/degree (no need for real
/// haversine precision in these tests — the job always calls `reverse`
/// with a fixed 50 km radius, so callers just need a candidate clearly
/// inside or clearly outside that).
struct FakeGeocoder {
    city: City,
    reverse_calls: AtomicUsize,
}

impl FakeGeocoder {
    fn new(city: City) -> Self {
        Self {
            city,
            reverse_calls: AtomicUsize::new(0),
        }
    }
}

impl Geocoder for FakeGeocoder {
    fn reverse(&self, lat: f64, lon: f64, max_km: f64) -> Option<&City> {
        self.reverse_calls.fetch_add(1, Ordering::Relaxed);
        let dlat = lat - self.city.lat;
        let dlon = lon - self.city.lon;
        let km = (dlat * dlat + dlon * dlon).sqrt() * 111.0;
        (km <= max_km).then_some(&self.city)
    }

    fn search(&self, _query: &str, _limit: usize) -> Vec<&City> {
        vec![&self.city]
    }
}

/// A [`Geocoder`] that never finds a city — every row it sees comes back
/// `None`, so it can never gain a `place_id` and always shows back up in
/// `list_ungeocoded`'s predicate — used to prove the drain loop's cursor
/// still advances past a row it can't place, instead of looping forever
/// re-fetching the same window.
struct NeverFindsGeocoder;

impl Geocoder for NeverFindsGeocoder {
    fn reverse(&self, _lat: f64, _lon: f64, _max_km: f64) -> Option<&City> {
        None
    }

    fn search(&self, _query: &str, _limit: usize) -> Vec<&City> {
        vec![]
    }
}

fn deps(catalog: Arc<dyn Catalog>, geocoder: Arc<dyn Geocoder>) -> GeocodeDeps {
    GeocodeDeps { catalog, geocoder }
}

/// Drains `rx` until (and including) the terminal `Finished`/`Cancelled`
/// event, returning every event seen plus the terminal one.
async fn drain_until_terminal(rx: &mut mpsc::Receiver<JobEvent>) -> (Vec<JobEvent>, JobEvent) {
    tokio::time::timeout(Duration::from_secs(10), async {
        let mut events = Vec::new();
        loop {
            let ev = rx
                .recv()
                .await
                .expect("channel closed before a terminal event arrived");
            let is_terminal = matches!(ev, JobEvent::Finished { .. } | JobEvent::Cancelled { .. });
            events.push(ev.clone());
            if is_terminal {
                return (events, ev);
            }
        }
    })
    .await
    .expect("timed out waiting for the job to reach a terminal state")
}

/// Runs a [`GeocodeJob`] to completion via a real [`JobRunner`], returning
/// every event seen plus the terminal one.
async fn run_geocode(catalog: &Arc<dyn Catalog>, geocoder: Arc<dyn Geocoder>) -> (Vec<JobEvent>, JobEvent) {
    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("geocode");
    let job = Arc::new(GeocodeJob::new(job_id.clone(), deps(catalog.clone(), geocoder)));
    runner.spawn(job_id, job);
    drain_until_terminal(&mut rx).await
}

#[tokio::test]
async fn assigns_the_nearest_city_within_50_km() {
    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive_id = drive(&catalog).await;
    // ~1 km from central Lisbon — well within the 50 km radius.
    let media_id = catalog
        .upsert_media(nm(drive_id, "a.jpg", "h-a", Some(38.73), Some(-9.14)))
        .await
        .unwrap();

    let geocoder: Arc<dyn Geocoder> = Arc::new(FakeGeocoder::new(lisbon()));
    let (events, terminal) = run_geocode(&catalog, geocoder).await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!((ok, failed, skipped), (1, 0, 0), "events: {events:?}");

    let (row, _) = catalog.get_media_with_drive(media_id).await.unwrap();
    assert!(row.place_id.is_some());

    let counts = catalog.list_place_counts().await.unwrap();
    assert_eq!(counts.len(), 1);
    assert_eq!(counts[0].place.name, "Lisbon");
    assert_eq!(counts[0].place.admin.as_deref(), Some("Lisboa"));
    assert_eq!(counts[0].place.country, "Portugal");
    assert_eq!(counts[0].place.source, PlaceSource::Geocoder);
    assert_eq!(counts[0].count, 1);
}

#[tokio::test]
async fn a_row_more_than_50_km_from_any_city_is_skipped_not_placed() {
    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive_id = drive(&catalog).await;
    // Roughly 1000+ km from Lisbon — well outside the 50 km radius.
    let media_id = catalog
        .upsert_media(nm(drive_id, "far.jpg", "h-far", Some(10.0), Some(10.0)))
        .await
        .unwrap();

    let geocoder: Arc<dyn Geocoder> = Arc::new(FakeGeocoder::new(lisbon()));
    let (events, terminal) = run_geocode(&catalog, geocoder).await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!((ok, failed, skipped), (0, 0, 1), "events: {events:?}");

    let (row, _) = catalog.get_media_with_drive(media_id).await.unwrap();
    assert_eq!(row.place_id, None);
    assert!(catalog.list_place_counts().await.unwrap().is_empty());
}

#[tokio::test]
async fn a_manually_placed_row_is_never_seen_by_the_job_and_keeps_its_place() {
    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive_id = drive(&catalog).await;
    let media_id = catalog
        .upsert_media(nm(drive_id, "manual.jpg", "h-manual", Some(38.73), Some(-9.14)))
        .await
        .unwrap();

    let manual_place = catalog
        .upsert_place(NewPlace {
            lat: 1.0,
            lon: 2.0,
            name: "My Custom Spot".into(),
            admin: None,
            country: "Portugal".into(),
            source: PlaceSource::Manual,
        })
        .await
        .unwrap();
    catalog
        .set_media_place(&[media_id], Some(manual_place.id))
        .await
        .unwrap();

    // Even though this row's GPS is right next to the fake geocoder's
    // city, `list_ungeocoded` excludes it (it already has a place_id), so
    // the job must never touch it.
    let geocoder: Arc<dyn Geocoder> = Arc::new(FakeGeocoder::new(lisbon()));
    let (events, terminal) = run_geocode(&catalog, geocoder).await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    assert_eq!((ok, failed, skipped), (0, 0, 0), "events: {events:?}");

    let (row, _) = catalog.get_media_with_drive(media_id).await.unwrap();
    assert_eq!(row.place_id, Some(manual_place.id));
    let counts = catalog.list_place_counts().await.unwrap();
    assert_eq!(counts.len(), 1);
    assert_eq!(counts[0].place.id, manual_place.id);
}

/// A row with no city in range never gains a `place_id`, so a loop that
/// kept re-fetching the same window would see it again on every pass and
/// spin forever. The cursor (`last_seen_id`, advanced past every row the
/// moment it's looked at — see `GeocodeJob::run_inner`) must stop the
/// sweep after looking at each row exactly once, by advancing past it
/// regardless of outcome.
#[tokio::test]
async fn drains_via_the_cursor_instead_of_looping_forever_on_unplaceable_rows() {
    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive_id = drive(&catalog).await;
    catalog
        .upsert_media(nm(drive_id, "a.jpg", "h-a", Some(1.0), Some(1.0)))
        .await
        .unwrap();
    catalog
        .upsert_media(nm(drive_id, "b.jpg", "h-b", Some(2.0), Some(2.0)))
        .await
        .unwrap();

    let geocoder: Arc<dyn Geocoder> = Arc::new(NeverFindsGeocoder);
    let (events, terminal) = run_geocode(&catalog, geocoder).await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    // Exactly one attempt per row, even though both remain forever
    // eligible for `list_ungeocoded` — proves the loop terminated because
    // the cursor ran off the end of the table, not because the catalog
    // ran out of candidates.
    assert_eq!((ok, failed, skipped), (0, 0, 2), "events: {events:?}");
}

/// Regression for the bug where a fixed-window drain (re-fetching
/// `list_ungeocoded(500)` and filtering by an in-memory attempted-set)
/// could permanently strand every row past the first entirely-unplaceable
/// batch: as soon as one page came back all-skipped, the attempted-set
/// would empty the *next* fetch and the loop would exit — never reaching
/// row 501+, this run or any future one. With `batch_size` shrunk to 2
/// via `with_batch_size`, the first page here is two mid-ocean rows (no
/// city within range of either) and the third row is a perfectly
/// placeable one — it must still be reached and geocoded.
#[tokio::test]
async fn a_later_row_is_still_geocoded_past_an_entirely_unplaceable_first_batch() {
    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive_id = drive(&catalog).await;

    catalog
        .upsert_media(nm(drive_id, "ocean-a.jpg", "h-oa", Some(0.0), Some(-140.0)))
        .await
        .unwrap();
    catalog
        .upsert_media(nm(drive_id, "ocean-b.jpg", "h-ob", Some(0.0), Some(-141.0)))
        .await
        .unwrap();
    let placeable_id = catalog
        .upsert_media(nm(drive_id, "lisbon.jpg", "h-lis", Some(38.73), Some(-9.14)))
        .await
        .unwrap();

    let geocoder: Arc<dyn Geocoder> = Arc::new(FakeGeocoder::new(lisbon()));
    let (tx, mut rx) = mpsc::channel(64);
    let runner = JobRunner::new(tx);
    let job_id = runner.next_id("geocode");
    let job = Arc::new(GeocodeJob::new(job_id.clone(), deps(catalog.clone(), geocoder)).with_batch_size(2));
    runner.spawn(job_id, job);

    let (events, terminal) = drain_until_terminal(&mut rx).await;
    let (ok, failed, skipped) = match terminal {
        JobEvent::Finished {
            ok, failed, skipped, ..
        } => (ok, failed, skipped),
        other => panic!("expected Finished, got {other:?} (events: {events:?})"),
    };
    // The two mid-ocean rows (first batch, entirely unplaceable) tally as
    // skipped; the third row (second batch) is still reached and placed.
    assert_eq!((ok, failed, skipped), (1, 0, 2), "events: {events:?}");

    let (row, _) = catalog.get_media_with_drive(placeable_id).await.unwrap();
    assert!(row.place_id.is_some());
}

#[tokio::test]
async fn cancel_stops_the_sweep_early() {
    let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
    let drive_id = drive(&catalog).await;
    catalog
        .upsert_media(nm(drive_id, "a.jpg", "h-a", Some(38.73), Some(-9.14)))
        .await
        .unwrap();
    catalog
        .upsert_media(nm(drive_id, "b.jpg", "h-b", Some(38.73), Some(-9.14)))
        .await
        .unwrap();

    let geocoder: Arc<dyn Geocoder> = Arc::new(FakeGeocoder::new(lisbon()));
    let job = GeocodeJob::new("geocode-cancel".into(), deps(catalog.clone(), geocoder));
    let (tx, _rx) = mpsc::channel(64);
    let cancel = CancellationToken::new();
    cancel.cancel();
    let ctx = JobCtx { events: tx, cancel };

    let outcome = job.run(ctx).await.unwrap();
    assert!(outcome.cancelled);
    assert_eq!((outcome.ok, outcome.failed, outcome.skipped), (0, 0, 0));

    // Nothing was touched — cancellation was observed before the first row.
    assert!(catalog.list_ungeocoded(0, 10).await.unwrap().len() == 2);
}
