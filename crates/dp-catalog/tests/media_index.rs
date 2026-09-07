use chrono::{TimeZone, Utc};
use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, MediaKind, MediaQuery, MediaSort, NewDrive, NewMedia};

/// A minimal photo/video `NewMedia`, for building a mixed-`taken_at`
/// seeded catalog (some dated, some `None`) that exercises every filter
/// `MediaQuery` supports.
fn mk(drive_id: i64, rel: &str, kind: MediaKind, ext: &str, day: Option<u32>) -> NewMedia {
    NewMedia {
        drive_id,
        rel_path: rel.into(),
        hash: rel.into(),
        size: 1,
        kind,
        ext: ext.into(),
        width: Some(800),
        height: Some(600),
        duration_ms: None,
        taken_at: day.map(|dd| Utc.with_ymd_and_hms(2025, 9, dd.clamp(1, 28), 12, 0, 0).unwrap()),
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

/// Seeds >= 25 rows: mixed kinds, mixed (including `NULL`) `taken_at`,
/// a "beach" stem to exercise the FTS filter, and one row reconciled
/// missing so `missing: Some(true/false)` has something to select.
async fn seeded_catalog() -> (SqliteCatalog, i64) {
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

    for i in 0..25u32 {
        let day = if i % 5 == 0 { None } else { Some(i + 1) };
        let kind = if i % 7 == 0 {
            MediaKind::Video
        } else {
            MediaKind::Photo
        };
        let ext = if kind == MediaKind::Video { "mp4" } else { "jpg" };
        let rel = format!("photo_{i:03}.{ext}");
        c.upsert_media(mk(d.id, &rel, kind, ext, day)).await.unwrap();
    }
    // A stem the FTS filter can find.
    c.upsert_media(mk(
        d.id,
        "vacation/sunset_beach.jpg",
        MediaKind::Photo,
        "jpg",
        Some(10),
    ))
    .await
    .unwrap();

    // One row explicitly marked missing via reconcile_missing, so the
    // `missing` filter has a real row to select.
    let source = c
        .upsert_source(dp_core::NewSource {
            drive_id: d.id,
            rel_path: "".into(),
        })
        .await
        .unwrap();
    c.upsert_media(NewMedia {
        source_id: Some(source.id),
        ..mk(d.id, "gone/lost.jpg", MediaKind::Photo, "jpg", Some(2))
    })
    .await
    .unwrap();
    c.reconcile_missing(d.id, source.id, &[]).await.unwrap();

    (c, d.id)
}

/// The index is the gallery's source of positions: entry N must be the
/// same row `query_media` returns at `offset = N`, or every hydrated tile
/// lands in the wrong place.
#[tokio::test]
async fn index_order_matches_query_media_at_the_same_offsets() {
    let (cat, _) = seeded_catalog().await;
    let q = MediaQuery {
        sort: MediaSort::TakenDesc,
        limit: 1000,
        offset: 0,
        ..Default::default()
    };

    let index = cat.media_index(&q).await.unwrap();
    let paged = cat.query_media(&q).await.unwrap();

    assert_eq!(index.len(), paged.len());
    for (i, entry) in index.iter().enumerate() {
        assert_eq!(entry.id, paged[i].0.id, "index position {i} disagrees");
    }
}

#[tokio::test]
async fn index_ignores_limit_and_offset() {
    let (cat, _) = seeded_catalog().await;
    let all = MediaQuery {
        limit: 1000,
        offset: 0,
        ..Default::default()
    };
    let narrow = MediaQuery {
        limit: 3,
        offset: 5,
        ..Default::default()
    };

    assert_eq!(
        cat.media_index(&all).await.unwrap().len(),
        cat.media_index(&narrow).await.unwrap().len()
    );
}

#[tokio::test]
async fn index_honors_every_filter() {
    let (cat, _) = seeded_catalog().await;
    for q in [
        MediaQuery {
            kinds: vec![MediaKind::Video],
            limit: 1000,
            ..Default::default()
        },
        MediaQuery {
            missing: Some(true),
            limit: 1000,
            ..Default::default()
        },
        MediaQuery {
            query: Some("beach".into()),
            limit: 1000,
            ..Default::default()
        },
    ] {
        let index = cat.media_index(&q).await.unwrap();
        let count = cat.count_media_query(&q).await.unwrap();
        assert_eq!(index.len() as u64, count, "index disagrees with count for {q:?}");
    }
}

#[tokio::test]
async fn index_carries_geometry_and_kind() {
    let (cat, _) = seeded_catalog().await;
    let entry = &cat.media_index(&Default::default()).await.unwrap()[0];
    assert!(entry.width.is_some() && entry.height.is_some());
}
