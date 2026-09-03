use chrono::{TimeZone, Utc};
use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{
    DriveRole, MediaKind, MediaQuery, MediaSort, NewDrive, NewMedia, NewPlace, NewSource, PlaceSource,
};

async fn seed() -> (SqliteCatalog, i64) {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let d = c
        .register_drive(NewDrive {
            name: "A".into(),
            mount_path: "/Volumes/A".into(),
            role: DriveRole::Archive,
            capacity: 1,
            free: 1,
            volume_uuid: None,
            volume_label: None,
        })
        .await
        .unwrap();
    let mk = |rel: &str, kind: MediaKind, ext: &str, day: Option<u32>| NewMedia {
        drive_id: d.id,
        rel_path: rel.into(),
        hash: rel.into(),
        size: 1,
        kind,
        ext: ext.into(),
        width: Some(4),
        height: Some(3),
        duration_ms: None,
        taken_at: day.map(|dd| Utc.with_ymd_and_hms(2025, 9, dd, 12, 0, 0).unwrap()),
        camera: None,
        lens: None,
        aperture: None,
        shutter: None,
        iso: None,
        focal_mm: None,
        lat: None,
        lon: None,
        organized_at: None,
        mtime: None,
        source_id: None,
    };
    c.upsert_media(mk("a.jpg", MediaKind::Photo, "jpg", Some(1)))
        .await
        .unwrap();
    c.upsert_media(mk("b.raf", MediaKind::Photo, "raf", Some(5)))
        .await
        .unwrap();
    c.upsert_media(mk("c.mp4", MediaKind::Video, "mp4", Some(3)))
        .await
        .unwrap();
    c.upsert_media(mk("d.heic", MediaKind::Photo, "heic", None))
        .await
        .unwrap();
    (c, d.id)
}

fn q() -> MediaQuery {
    MediaQuery {
        limit: 100,
        ..Default::default()
    }
}

/// A minimal photo `NewMedia`, for tests below that only care about
/// `rel_path` (and thus the FTS stem it produces) — everything else is a
/// plausible-but-irrelevant default, same spirit as `seed()`'s `mk`.
fn photo(drive_id: i64, rel: &str, hash: &str) -> NewMedia {
    NewMedia {
        drive_id,
        rel_path: rel.into(),
        hash: hash.into(),
        size: 1,
        kind: MediaKind::Photo,
        ext: "jpg".into(),
        width: Some(4),
        height: Some(3),
        duration_ms: None,
        taken_at: None,
        camera: None,
        lens: None,
        aperture: None,
        shutter: None,
        iso: None,
        focal_mm: None,
        lat: None,
        lon: None,
        organized_at: None,
        mtime: None,
        source_id: None,
    }
}

#[tokio::test]
async fn default_query_returns_all_newest_first_undated_last() {
    let (c, _) = seed().await;
    let rows: Vec<String> = c
        .query_media(&q())
        .await
        .unwrap()
        .into_iter()
        .map(|(m, _)| m.rel_path)
        .collect();
    assert_eq!(rows, ["b.raf", "c.mp4", "a.jpg", "d.heic"]);
}

#[tokio::test]
async fn filter_by_exts() {
    let (c, _) = seed().await;
    let r = c
        .query_media(&MediaQuery {
            exts: vec!["jpg".into(), "jpeg".into()],
            ..q()
        })
        .await
        .unwrap();
    assert_eq!(r.len(), 1);
    assert_eq!(r[0].0.rel_path, "a.jpg");
}

#[tokio::test]
async fn filter_by_kind_video() {
    let (c, _) = seed().await;
    let r = c
        .query_media(&MediaQuery {
            kinds: vec![MediaKind::Video],
            ..q()
        })
        .await
        .unwrap();
    assert_eq!(r.len(), 1);
    assert_eq!(r[0].0.rel_path, "c.mp4");
}

#[tokio::test]
async fn sort_oldest_and_added() {
    let (c, _) = seed().await;
    let oldest: Vec<String> = c
        .query_media(&MediaQuery {
            sort: MediaSort::TakenAsc,
            ..q()
        })
        .await
        .unwrap()
        .into_iter()
        .map(|(m, _)| m.rel_path)
        .collect();
    assert_eq!(oldest, ["a.jpg", "c.mp4", "b.raf", "d.heic"]);
    let added: Vec<String> = c
        .query_media(&MediaQuery {
            sort: MediaSort::AddedDesc,
            ..q()
        })
        .await
        .unwrap()
        .into_iter()
        .map(|(m, _)| m.rel_path)
        .collect();
    assert_eq!(added, ["d.heic", "c.mp4", "b.raf", "a.jpg"]);
}

#[tokio::test]
async fn paging_and_count() {
    let (c, _) = seed().await;
    let page = c
        .query_media(&MediaQuery {
            limit: 2,
            offset: 2,
            ..q()
        })
        .await
        .unwrap();
    assert_eq!(
        page.iter().map(|(m, _)| m.rel_path.as_str()).collect::<Vec<_>>(),
        ["a.jpg", "d.heic"]
    );
    assert_eq!(c.count_media_query(&q()).await.unwrap(), 4);
    assert_eq!(
        c.count_media_query(&MediaQuery {
            kinds: vec![MediaKind::Video],
            ..q()
        })
        .await
        .unwrap(),
        1
    );
}

#[tokio::test]
async fn filter_by_place_id() {
    let (c, _) = seed().await;
    let place = c
        .upsert_place(NewPlace {
            lat: 38.7,
            lon: -9.1,
            name: "Lisbon".into(),
            admin: Some("Lisboa".into()),
            country: "Portugal".into(),
            source: PlaceSource::Geocoder,
        })
        .await
        .unwrap();
    let target = c.query_media(&q()).await.unwrap()[0].0.id;
    c.set_media_place(&[target], Some(place.id)).await.unwrap();

    let r = c
        .query_media(&MediaQuery {
            place_id: Some(place.id),
            ..q()
        })
        .await
        .unwrap();
    assert_eq!(r.len(), 1);
    assert_eq!(r[0].0.id, target);

    assert_eq!(
        c.count_media_query(&MediaQuery {
            place_id: Some(place.id),
            ..q()
        })
        .await
        .unwrap(),
        1
    );
}

#[tokio::test]
async fn filter_by_tag_ids() {
    let (c, _) = seed().await;
    let all = c.query_media(&q()).await.unwrap();
    let target = all.iter().find(|(m, _)| m.rel_path == "a.jpg").unwrap().0.id;
    let other = all.iter().find(|(m, _)| m.rel_path == "b.raf").unwrap().0.id;

    c.tag_media(&[target], &["Trip".into()], &[]).await.unwrap();
    let tag_id = c.list_tags().await.unwrap()[0].id;

    let r = c
        .query_media(&MediaQuery {
            tag_ids: vec![tag_id],
            ..q()
        })
        .await
        .unwrap();
    assert_eq!(r.len(), 1);
    assert_eq!(r[0].0.id, target);

    assert_eq!(
        c.count_media_query(&MediaQuery {
            tag_ids: vec![tag_id],
            ..q()
        })
        .await
        .unwrap(),
        1
    );

    // Composes with another filter (kind), narrowing further rather than
    // ORing.
    c.tag_media(&[other], &["Trip".into()], &[]).await.unwrap();
    let r = c
        .query_media(&MediaQuery {
            tag_ids: vec![tag_id],
            kinds: vec![MediaKind::Photo],
            ..q()
        })
        .await
        .unwrap();
    let mut ids: Vec<i64> = r.iter().map(|(m, _)| m.id).collect();
    ids.sort();
    let mut expected = vec![target, other];
    expected.sort();
    assert_eq!(ids, expected);
}

#[tokio::test]
async fn filter_by_missing() {
    let (c, drive_id) = seed().await;
    let source = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "".into(),
        })
        .await
        .unwrap();
    // A fifth row, attributed to `source`, so `reconcile_missing` (scoped
    // by drive+source) has something to mark; the four seeded rows keep
    // their `source_id: None` and are deliberately left untouched by it.
    c.upsert_media(NewMedia {
        drive_id,
        rel_path: "e.jpg".into(),
        hash: "e.jpg".into(),
        size: 1,
        kind: MediaKind::Photo,
        ext: "jpg".into(),
        width: Some(4),
        height: Some(3),
        duration_ms: None,
        taken_at: Some(Utc.with_ymd_and_hms(2025, 9, 1, 12, 0, 0).unwrap()),
        camera: None,
        lens: None,
        aperture: None,
        shutter: None,
        iso: None,
        focal_mm: None,
        lat: None,
        lon: None,
        organized_at: None,
        mtime: None,
        source_id: Some(source.id),
    })
    .await
    .unwrap();

    // Nothing seen this scan for `source` — e.jpg gets marked missing.
    c.reconcile_missing(drive_id, source.id, &[]).await.unwrap();

    let missing_only = c
        .query_media(&MediaQuery {
            missing: Some(true),
            ..q()
        })
        .await
        .unwrap();
    assert_eq!(missing_only.len(), 1);
    assert_eq!(missing_only[0].0.rel_path, "e.jpg");

    let present_only = c
        .query_media(&MediaQuery {
            missing: Some(false),
            ..q()
        })
        .await
        .unwrap();
    assert_eq!(present_only.len(), 4, "the 4 originally-seeded rows stay present");
    assert!(present_only.iter().all(|(m, _)| m.rel_path != "e.jpg"));

    // `missing: None` (the default) must still include every row.
    assert_eq!(c.query_media(&q()).await.unwrap().len(), 5);

    assert_eq!(
        c.count_media_query(&MediaQuery {
            missing: Some(true),
            ..q()
        })
        .await
        .unwrap(),
        1
    );
}

#[tokio::test]
async fn filter_by_query_matches_stem() {
    let (c, drive_id) = seed().await;
    c.upsert_media(photo(drive_id, "vacation/sunset_beach.jpg", "sunset-hash"))
        .await
        .unwrap();

    let r = c
        .query_media(&MediaQuery {
            query: Some("sunset".into()),
            ..q()
        })
        .await
        .unwrap();
    assert_eq!(r.len(), 1);
    assert_eq!(r[0].0.rel_path, "vacation/sunset_beach.jpg");

    assert_eq!(
        c.count_media_query(&MediaQuery {
            query: Some("sunset".into()),
            ..q()
        })
        .await
        .unwrap(),
        1
    );
}

#[tokio::test]
async fn filter_by_query_combined_with_kind() {
    let (c, drive_id) = seed().await;
    c.upsert_media(photo(drive_id, "trip/roadtrip_photo.jpg", "rt-photo"))
        .await
        .unwrap();
    c.upsert_media(NewMedia {
        kind: MediaKind::Video,
        ext: "mp4".into(),
        ..photo(drive_id, "trip/roadtrip_clip.mp4", "rt-video")
    })
    .await
    .unwrap();

    let r = c
        .query_media(&MediaQuery {
            query: Some("roadtrip".into()),
            kinds: vec![MediaKind::Video],
            ..q()
        })
        .await
        .unwrap();
    assert_eq!(r.len(), 1);
    assert_eq!(r[0].0.rel_path, "trip/roadtrip_clip.mp4");
}

#[tokio::test]
async fn filter_by_query_combined_with_missing() {
    let (c, drive_id) = seed().await;
    let source = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "".into(),
        })
        .await
        .unwrap();
    c.upsert_media(NewMedia {
        source_id: Some(source.id),
        ..photo(drive_id, "gone/lostpuppy.jpg", "lostpuppy-hash")
    })
    .await
    .unwrap();
    // Nothing seen this scan for `source` — lostpuppy.jpg gets marked missing.
    c.reconcile_missing(drive_id, source.id, &[]).await.unwrap();

    let r = c
        .query_media(&MediaQuery {
            query: Some("lostpuppy".into()),
            missing: Some(true),
            ..q()
        })
        .await
        .unwrap();
    assert_eq!(r.len(), 1);
    assert_eq!(r[0].0.rel_path, "gone/lostpuppy.jpg");

    // Same query but restricted to present rows: the missing row is
    // filtered out even though it still matches the search term.
    assert!(c
        .query_media(&MediaQuery {
            query: Some("lostpuppy".into()),
            missing: Some(false),
            ..q()
        })
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn filter_by_query_combined_with_place() {
    let (c, drive_id) = seed().await;
    let place = c
        .upsert_place(NewPlace {
            lat: 38.7,
            lon: -9.1,
            name: "Lisbon".into(),
            admin: Some("Lisboa".into()),
            country: "Portugal".into(),
            source: PlaceSource::Geocoder,
        })
        .await
        .unwrap();
    let id = c
        .upsert_media(photo(drive_id, "trip/castle_view.jpg", "castle-hash"))
        .await
        .unwrap();
    c.set_media_place(&[id], Some(place.id)).await.unwrap();

    // Matches on place name alone (no `query`).
    let by_place = c
        .query_media(&MediaQuery {
            place_id: Some(place.id),
            ..q()
        })
        .await
        .unwrap();
    assert_eq!(by_place.len(), 1);
    assert_eq!(by_place[0].0.id, id);

    // `query` narrows the same place-scoped set by stem.
    let by_place_and_query = c
        .query_media(&MediaQuery {
            place_id: Some(place.id),
            query: Some("castle".into()),
            ..q()
        })
        .await
        .unwrap();
    assert_eq!(by_place_and_query.len(), 1);
    assert_eq!(by_place_and_query[0].0.id, id);

    // A `query` that doesn't match this place-scoped row returns nothing.
    assert!(c
        .query_media(&MediaQuery {
            place_id: Some(place.id),
            query: Some("nonexistentterm".into()),
            ..q()
        })
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn empty_and_whitespace_query_behaves_as_no_filter() {
    let (c, _) = seed().await;
    let all = c.query_media(&q()).await.unwrap().len();

    assert_eq!(
        c.query_media(&MediaQuery {
            query: Some("".into()),
            ..q()
        })
        .await
        .unwrap()
        .len(),
        all
    );
    assert_eq!(
        c.query_media(&MediaQuery {
            query: Some("   ".into()),
            ..q()
        })
        .await
        .unwrap()
        .len(),
        all
    );
    assert_eq!(
        c.count_media_query(&MediaQuery {
            query: Some("   ".into()),
            ..q()
        })
        .await
        .unwrap(),
        all as u64
    );
}

#[tokio::test]
async fn unsanitized_query_does_not_error() {
    let (c, _) = seed().await;

    // Must not error out as invalid FTS5 syntax — special characters are
    // sanitized out of every token before it reaches the query parser
    // (same sanitizer `fts::search_media` uses, reused here).
    let r = c
        .query_media(&MediaQuery {
            query: Some("a\"b OR \"x".into()),
            ..q()
        })
        .await
        .unwrap();
    assert!(r.is_empty());

    assert_eq!(
        c.count_media_query(&MediaQuery {
            query: Some("a\"b OR \"x".into()),
            ..q()
        })
        .await
        .unwrap(),
        0
    );
}

#[tokio::test]
async fn get_media_with_drive_and_not_found() {
    let (c, did) = seed().await;
    let (m, d) = c.query_media(&q()).await.unwrap().remove(0);
    let (m2, d2) = c.get_media_with_drive(m.id).await.unwrap();
    assert_eq!(m2.id, m.id);
    assert_eq!(d2.id, did);
    assert_eq!(d.id, did);
    assert!(matches!(
        c.get_media_with_drive(999).await,
        Err(dp_core::DpError::NotFound { .. })
    ));
}
