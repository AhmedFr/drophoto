use std::sync::Arc;

use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, MediaKind, NewDrive, NewMedia, NewPlace, PlaceSource};

fn nm(drive_id: i64, rel_path: &str, hash: &str, lat: Option<f64>, lon: Option<f64>) -> NewMedia {
    NewMedia {
        drive_id,
        rel_path: rel_path.into(),
        hash: hash.into(),
        size: 1234,
        kind: MediaKind::Photo,
        ext: "jpg".into(),
        width: Some(100),
        height: Some(200),
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

fn geocoder_place(name: &str, admin: Option<&str>, country: &str) -> NewPlace {
    NewPlace {
        lat: 38.7223,
        lon: -9.1393,
        name: name.into(),
        admin: admin.map(Into::into),
        country: country.into(),
        source: PlaceSource::Geocoder,
    }
}

async fn drive(c: &SqliteCatalog) -> i64 {
    c.register_drive(NewDrive {
        name: "A".into(),
        mount_path: "/Volumes/A".into(),
        role: DriveRole::Archive,
        capacity: 100,
        free: 40,
        volume_uuid: None,
        volume_label: None,
    })
    .await
    .unwrap()
    .id
}

#[tokio::test]
async fn upsert_place_dedupes_geocoder_rows_by_name_admin_country() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();

    let first = c
        .upsert_place(geocoder_place("Lisbon", Some("Lisboa"), "Portugal"))
        .await
        .unwrap();
    let second = c
        .upsert_place(geocoder_place("Lisbon", Some("Lisboa"), "Portugal"))
        .await
        .unwrap();

    assert_eq!(first.id, second.id);

    let different_admin = c
        .upsert_place(geocoder_place("Lisbon", Some("Somewhere Else"), "Portugal"))
        .await
        .unwrap();
    assert_ne!(first.id, different_admin.id);
}

#[tokio::test]
async fn upsert_place_dedupes_when_admin_is_none() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();

    let first = c
        .upsert_place(geocoder_place("Lisbon", None, "Portugal"))
        .await
        .unwrap();
    let second = c
        .upsert_place(geocoder_place("Lisbon", None, "Portugal"))
        .await
        .unwrap();

    assert_eq!(first.id, second.id);
    assert_eq!(first.admin, None);
}

/// Two concurrent geocode/manual calls resolving to the same identity
/// must never both win the race and create duplicate rows — the
/// `places_identity` unique index plus `upsert_place`'s `ON CONFLICT DO
/// NOTHING` insert (mirroring `upsert_source`) is what prevents it.
#[tokio::test]
async fn concurrent_upsert_place_of_the_same_identity_creates_one_row() {
    let c: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());

    let c1 = c.clone();
    let c2 = c.clone();
    let t1 = tokio::spawn(async move {
        c1.upsert_place(geocoder_place("Lisbon", Some("Lisboa"), "Portugal"))
            .await
            .unwrap()
    });
    let t2 = tokio::spawn(async move {
        c2.upsert_place(geocoder_place("Lisbon", Some("Lisboa"), "Portugal"))
            .await
            .unwrap()
    });

    let (first, second) = tokio::join!(t1, t2);
    let first = first.unwrap();
    let second = second.unwrap();

    assert_eq!(first.id, second.id);

    let counts = c.list_place_counts().await.unwrap();
    // Nothing references this place yet, so it wouldn't show up in
    // `list_place_counts` anyway — assert row uniqueness directly instead
    // via a second upsert, which must resolve to the very same id.
    assert!(counts.is_empty());
    let third = c
        .upsert_place(geocoder_place("Lisbon", Some("Lisboa"), "Portugal"))
        .await
        .unwrap();
    assert_eq!(third.id, first.id);
}

#[tokio::test]
async fn list_place_counts_counts_media_and_skips_empty_places() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let lisbon = c
        .upsert_place(geocoder_place("Lisbon", Some("Lisboa"), "Portugal"))
        .await
        .unwrap();
    // A place nobody references yet.
    c.upsert_place(geocoder_place("Porto", Some("Porto"), "Portugal"))
        .await
        .unwrap();

    let a = c
        .upsert_media(nm(drive_id, "a.jpg", "h-a", Some(38.7), Some(-9.1)))
        .await
        .unwrap();
    let b = c
        .upsert_media(nm(drive_id, "b.jpg", "h-b", Some(38.7), Some(-9.1)))
        .await
        .unwrap();
    c.set_media_place(&[a, b], Some(lisbon.id)).await.unwrap();

    let counts = c.list_place_counts().await.unwrap();
    assert_eq!(counts.len(), 1);
    assert_eq!(counts[0].place.id, lisbon.id);
    assert_eq!(counts[0].count, 2);
}

#[tokio::test]
async fn set_media_place_sets_clears_and_is_searchable() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let lisbon = c
        .upsert_place(geocoder_place("Lisbon", Some("Lisboa"), "Portugal"))
        .await
        .unwrap();
    let a = c
        .upsert_media(nm(drive_id, "a.jpg", "h-a", Some(38.7), Some(-9.1)))
        .await
        .unwrap();

    assert!(c.search_media("lisbon", 10).await.unwrap().is_empty());

    c.set_media_place(&[a], Some(lisbon.id)).await.unwrap();
    let found = c.search_media("lisbon", 10).await.unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].0.id, a);
    assert_eq!(found[0].0.place_id, Some(lisbon.id));

    c.set_media_place(&[a], None).await.unwrap();
    assert!(c.search_media("lisbon", 10).await.unwrap().is_empty());
    let (row, _) = c.get_media_with_drive(a).await.unwrap();
    assert_eq!(row.place_id, None);
}

#[tokio::test]
async fn list_ungeocoded_excludes_no_gps_has_place_and_manual_skipped() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    // No GPS at all — excluded.
    c.upsert_media(nm(drive_id, "no-gps.jpg", "h-1", None, None))
        .await
        .unwrap();

    // GPS, no place — the one row that should come back.
    let needs_geocode = c
        .upsert_media(nm(drive_id, "needs-geocode.jpg", "h-2", Some(1.0), Some(2.0)))
        .await
        .unwrap();

    // GPS, already has a geocoder place — excluded.
    let already_placed = c
        .upsert_media(nm(drive_id, "already-placed.jpg", "h-3", Some(1.0), Some(2.0)))
        .await
        .unwrap();
    let place = c
        .upsert_place(geocoder_place("Lisbon", Some("Lisboa"), "Portugal"))
        .await
        .unwrap();
    c.set_media_place(&[already_placed], Some(place.id))
        .await
        .unwrap();

    // GPS, manually assigned a place — excluded (place_id is set, same as
    // any other place assignment).
    let manual_row = c
        .upsert_media(nm(drive_id, "manual.jpg", "h-4", Some(1.0), Some(2.0)))
        .await
        .unwrap();
    let manual_place = c
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
    c.set_media_place(&[manual_row], Some(manual_place.id))
        .await
        .unwrap();

    let ungeocoded = c.list_ungeocoded(0, 100).await.unwrap();
    let ids: Vec<i64> = ungeocoded.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![needs_geocode]);
}

#[tokio::test]
async fn list_ungeocoded_respects_limit() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    for i in 0..3 {
        c.upsert_media(nm(
            drive_id,
            &format!("{i}.jpg"),
            &format!("h-{i}"),
            Some(1.0),
            Some(2.0),
        ))
        .await
        .unwrap();
    }

    let limited = c.list_ungeocoded(0, 2).await.unwrap();
    assert_eq!(limited.len(), 2);
}

/// C1 regression: clearing a place (`set_media_place(ids, None)`) must be
/// durable — the row must not silently come back into
/// `list_ungeocoded`'s result set, which would let the geocode job
/// immediately re-assign a place the user explicitly removed.
#[tokio::test]
async fn cleared_place_stays_out_of_list_ungeocoded() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let lisbon = c
        .upsert_place(geocoder_place("Lisbon", Some("Lisboa"), "Portugal"))
        .await
        .unwrap();
    let a = c
        .upsert_media(nm(drive_id, "a.jpg", "h-a", Some(38.7), Some(-9.1)))
        .await
        .unwrap();
    c.set_media_place(&[a], Some(lisbon.id)).await.unwrap();

    // Clearing must not put the row back into the ungeocoded set.
    c.set_media_place(&[a], None).await.unwrap();
    let ungeocoded = c.list_ungeocoded(0, 100).await.unwrap();
    assert!(ungeocoded.iter().all(|r| r.id != a));
}

/// Re-assigning a place (geocoder or manual) after a clear must reset the
/// cleared flag — a subsequent clear-then-assign-then-clear cycle should
/// behave the same way every time, not "stick" cleared forever.
#[tokio::test]
async fn reassigning_after_a_clear_clears_the_cleared_flag() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let lisbon = c
        .upsert_place(geocoder_place("Lisbon", Some("Lisboa"), "Portugal"))
        .await
        .unwrap();
    let a = c
        .upsert_media(nm(drive_id, "a.jpg", "h-a", Some(38.7), Some(-9.1)))
        .await
        .unwrap();

    c.set_media_place(&[a], Some(lisbon.id)).await.unwrap();
    c.set_media_place(&[a], None).await.unwrap();
    // Manually re-assign a place after the clear.
    c.set_media_place(&[a], Some(lisbon.id)).await.unwrap();
    // Clear again — must take effect again, not be a no-op because the
    // flag was never reset by the re-assignment above.
    c.set_media_place(&[a], None).await.unwrap();

    let ungeocoded = c.list_ungeocoded(0, 100).await.unwrap();
    assert!(ungeocoded.iter().all(|r| r.id != a));
}

/// A geocode-job run after a user clear must leave the row placeless —
/// simulated here without the job itself (that's `dp-jobs`'s concern):
/// `list_ungeocoded` excluding the row is what makes the job skip it,
/// which this test asserts directly.
#[tokio::test]
async fn cleared_row_is_not_picked_up_by_a_subsequent_geocode_pass() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let lisbon = c
        .upsert_place(geocoder_place("Lisbon", Some("Lisboa"), "Portugal"))
        .await
        .unwrap();
    let a = c
        .upsert_media(nm(drive_id, "a.jpg", "h-a", Some(38.7), Some(-9.1)))
        .await
        .unwrap();
    c.set_media_place(&[a], Some(lisbon.id)).await.unwrap();
    c.set_media_place(&[a], None).await.unwrap();

    // First "pass": row must not show up.
    assert!(c.list_ungeocoded(0, 100).await.unwrap().iter().all(|r| r.id != a));
    // Second "pass" (simulating the job running again later): still not
    // picked up — the exclusion isn't a one-shot side effect of the
    // clear call itself.
    assert!(c.list_ungeocoded(0, 100).await.unwrap().iter().all(|r| r.id != a));
    let (row, _) = c.get_media_with_drive(a).await.unwrap();
    assert_eq!(row.place_id, None);
}

/// A row with GPS that has never been touched by `set_media_place` at all
/// must still geocode normally — the new `place_cleared` column defaults
/// to 0 for every row, so plain never-placed rows aren't accidentally
/// excluded by the C1 fix.
#[tokio::test]
async fn never_placed_gps_row_still_geocodes() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let a = c
        .upsert_media(nm(drive_id, "a.jpg", "h-a", Some(38.7), Some(-9.1)))
        .await
        .unwrap();

    let ungeocoded = c.list_ungeocoded(0, 100).await.unwrap();
    assert_eq!(ungeocoded.iter().map(|r| r.id).collect::<Vec<_>>(), vec![a]);
}

/// The pagination contract the geocode job's drain loop depends on:
/// `after_id` excludes every row with `id <= after_id`, so paging by the
/// max id seen in the previous page can never re-show (or skip) a row.
#[tokio::test]
async fn list_ungeocoded_after_id_excludes_rows_at_or_below_the_cursor() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let mut ids = Vec::new();
    for i in 0..3 {
        let id = c
            .upsert_media(nm(
                drive_id,
                &format!("{i}.jpg"),
                &format!("h-{i}"),
                Some(1.0),
                Some(2.0),
            ))
            .await
            .unwrap();
        ids.push(id);
    }

    let page = c.list_ungeocoded(ids[0], 100).await.unwrap();
    let page_ids: Vec<i64> = page.iter().map(|r| r.id).collect();
    assert_eq!(page_ids, vec![ids[1], ids[2]]);

    // Paging past the last row's id returns nothing — the drain loop's
    // termination condition.
    assert!(c.list_ungeocoded(ids[2], 100).await.unwrap().is_empty());
}
