use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, MediaKind, NewDrive, NewMedia, NewSource, OrganizeItemRow, PlanStatus};

fn nm(drive_id: i64, rel_path: &str, hash: &str, source_id: Option<i64>) -> NewMedia {
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
        lat: None,
        lon: None,
        organized_at: None,
        mtime: None,
        source_id,
    }
}

async fn drive_with_source(c: &SqliteCatalog) -> (i64, i64) {
    let drive_id = c
        .register_drive(NewDrive {
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
        .id;
    let source_id = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "".into(),
        })
        .await
        .unwrap()
        .id;
    (drive_id, source_id)
}

#[tokio::test]
async fn reconcile_missing_marks_rows_not_in_the_seen_set() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let (drive_id, source_id) = drive_with_source(&c).await;
    let a = c
        .upsert_media(nm(drive_id, "a.jpg", "hash-a", Some(source_id)))
        .await
        .unwrap();
    let b = c
        .upsert_media(nm(drive_id, "b.jpg", "hash-b", Some(source_id)))
        .await
        .unwrap();

    let marked = c
        .reconcile_missing(drive_id, source_id, &["a.jpg".to_string()])
        .await
        .unwrap();
    assert_eq!(marked, 1, "only b.jpg was left out of the seen set");

    let (a_row, _) = c.get_media_with_drive(a).await.unwrap();
    let (b_row, _) = c.get_media_with_drive(b).await.unwrap();
    assert!(a_row.missing_at.is_none(), "a.jpg was seen — must stay present");
    assert!(
        b_row.missing_at.is_some(),
        "b.jpg was not seen — must be marked missing"
    );
}

#[tokio::test]
async fn reconcile_missing_clears_missing_at_on_rows_seen_again() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let (drive_id, source_id) = drive_with_source(&c).await;
    let a = c
        .upsert_media(nm(drive_id, "a.jpg", "hash-a", Some(source_id)))
        .await
        .unwrap();

    // First scan: a.jpg isn't seen — gets marked missing.
    c.reconcile_missing(drive_id, source_id, &[]).await.unwrap();
    let (row, _) = c.get_media_with_drive(a).await.unwrap();
    assert!(row.missing_at.is_some());

    // Second scan: a.jpg reappears — must be cleared, exercising the
    // Task 5a follow-up (the incremental-skip path never called
    // `upsert_media`, so nothing else would have cleared it).
    c.reconcile_missing(drive_id, source_id, &["a.jpg".to_string()])
        .await
        .unwrap();
    let (row, _) = c.get_media_with_drive(a).await.unwrap();
    assert!(
        row.missing_at.is_none(),
        "a.jpg reappeared — missing_at must be cleared"
    );
}

#[tokio::test]
async fn reconcile_missing_keeps_the_first_detected_timestamp() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let (drive_id, source_id) = drive_with_source(&c).await;
    c.upsert_media(nm(drive_id, "a.jpg", "hash-a", Some(source_id)))
        .await
        .unwrap();

    c.reconcile_missing(drive_id, source_id, &[]).await.unwrap();
    let (row, _) = c.get_media_with_drive(1).await.unwrap();
    let first_missing_at = row.missing_at.expect("marked missing by the first reconcile");

    // A second reconcile that still doesn't see the file must not move
    // the timestamp forward — "missing since" is a first-detected time,
    // not "as of the last scan".
    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    c.reconcile_missing(drive_id, source_id, &[]).await.unwrap();
    let (row, _) = c.get_media_with_drive(1).await.unwrap();
    assert_eq!(row.missing_at, Some(first_missing_at));
}

#[tokio::test]
async fn reconcile_missing_is_scoped_to_drive_and_source() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let (drive_id, source_id) = drive_with_source(&c).await;
    let other_source_id = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "other".into(),
        })
        .await
        .unwrap()
        .id;

    let in_scope = c
        .upsert_media(nm(drive_id, "a.jpg", "hash-a", Some(source_id)))
        .await
        .unwrap();
    let other_source = c
        .upsert_media(nm(drive_id, "b.jpg", "hash-b", Some(other_source_id)))
        .await
        .unwrap();
    let no_source = c
        .upsert_media(nm(drive_id, "c.jpg", "hash-c", None))
        .await
        .unwrap();

    // Reconciling `source_id` with an empty seen set must only ever touch
    // rows attributed to that exact source.
    c.reconcile_missing(drive_id, source_id, &[]).await.unwrap();

    let (a_row, _) = c.get_media_with_drive(in_scope).await.unwrap();
    let (b_row, _) = c.get_media_with_drive(other_source).await.unwrap();
    let (c_row, _) = c.get_media_with_drive(no_source).await.unwrap();
    assert!(a_row.missing_at.is_some());
    assert!(
        b_row.missing_at.is_none(),
        "a different source's rows must be untouched"
    );
    assert!(
        c_row.missing_at.is_none(),
        "source-less (legacy) rows must be untouched"
    );
}

#[tokio::test]
async fn reconcile_missing_handles_more_than_one_insert_chunk() {
    // The temp-table insert is chunked at 500 rows per statement — this
    // proves a seen set spanning multiple chunks round-trips correctly
    // rather than only ever "seeing" the first chunk.
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let (drive_id, source_id) = drive_with_source(&c).await;

    let mut seen = Vec::new();
    for i in 0..1200 {
        let rel = format!("f{i}.jpg");
        c.upsert_media(nm(drive_id, &rel, &format!("hash-{i}"), Some(source_id)))
            .await
            .unwrap();
        seen.push(rel);
    }
    // One extra row deliberately left out of the seen set.
    let missing_id = c
        .upsert_media(nm(drive_id, "left-out.jpg", "hash-left-out", Some(source_id)))
        .await
        .unwrap();

    let marked = c.reconcile_missing(drive_id, source_id, &seen).await.unwrap();
    assert_eq!(marked, 1);

    let (missing_row, _) = c.get_media_with_drive(missing_id).await.unwrap();
    assert!(missing_row.missing_at.is_some());
    assert_eq!(c.count_media(Some(drive_id)).await.unwrap(), 1201);
}

#[tokio::test]
async fn count_missing_counts_only_this_drives_missing_rows() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let (drive_id, source_id) = drive_with_source(&c).await;
    c.upsert_media(nm(drive_id, "a.jpg", "hash-a", Some(source_id)))
        .await
        .unwrap();
    c.upsert_media(nm(drive_id, "b.jpg", "hash-b", Some(source_id)))
        .await
        .unwrap();

    assert_eq!(c.count_missing(drive_id).await.unwrap(), 0);

    c.reconcile_missing(drive_id, source_id, &["a.jpg".to_string()])
        .await
        .unwrap();
    assert_eq!(c.count_missing(drive_id).await.unwrap(), 1);
}

#[tokio::test]
async fn remove_missing_deletes_only_missing_rows_and_syncs_fts() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let (drive_id, source_id) = drive_with_source(&c).await;
    c.upsert_media(nm(drive_id, "img_1111.jpg", "hash-a", Some(source_id)))
        .await
        .unwrap();
    c.upsert_media(nm(drive_id, "img_2222.jpg", "hash-b", Some(source_id)))
        .await
        .unwrap();

    c.reconcile_missing(drive_id, source_id, &["img_2222.jpg".to_string()])
        .await
        .unwrap();
    assert_eq!(c.count_missing(drive_id).await.unwrap(), 1);
    assert_eq!(c.search_media("img_1111", 10).await.unwrap().len(), 1);

    let removed = c.remove_missing(drive_id).await.unwrap();
    assert_eq!(removed, 1);
    assert_eq!(
        c.count_media(Some(drive_id)).await.unwrap(),
        1,
        "only the present row remains"
    );
    assert_eq!(
        c.search_media("img_1111", 10).await.unwrap().len(),
        0,
        "the removed row's FTS entry must be gone too"
    );
    assert_eq!(
        c.search_media("img_2222", 10).await.unwrap().len(),
        1,
        "the still-present row must be untouched"
    );
}

/// Mirrors `delete_media_keeps_a_row_an_organize_item_references` in
/// `media.rs`'s own test suite: `remove_missing` reuses `delete_media` per
/// row, so a missing row an `organize_items` row still references must be
/// left in place rather than stranding that job's revert history.
#[tokio::test]
async fn remove_missing_keeps_a_row_an_organize_item_references() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let (drive_id, source_id) = drive_with_source(&c).await;
    let id = c
        .upsert_media(nm(drive_id, "a.jpg", "hash-a", Some(source_id)))
        .await
        .unwrap();
    let job_id = c.create_organize_job(drive_id, 1).await.unwrap();
    c.insert_organize_item(&OrganizeItemRow {
        id: 0,
        job_id,
        media_id: id,
        old_rel_path: "a.jpg".into(),
        new_rel_path: "archive/a.jpg".into(),
        status: PlanStatus::Moved,
        error: None,
    })
    .await
    .unwrap();

    c.reconcile_missing(drive_id, source_id, &[]).await.unwrap();
    assert_eq!(c.count_missing(drive_id).await.unwrap(), 1);

    let removed = c.remove_missing(drive_id).await.unwrap();
    assert_eq!(removed, 0, "the row is still referenced by an organize job");
    assert_eq!(c.count_media(Some(drive_id)).await.unwrap(), 1);
}

#[tokio::test]
async fn remove_missing_is_scoped_to_its_drive() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let (drive_a, source_a) = drive_with_source(&c).await;
    let drive_b = c
        .register_drive(NewDrive {
            name: "B".into(),
            mount_path: "/Volumes/B".into(),
            role: DriveRole::Archive,
            capacity: 100,
            free: 40,
            volume_uuid: None,
            volume_label: None,
        })
        .await
        .unwrap()
        .id;
    let source_b = c
        .upsert_source(NewSource {
            drive_id: drive_b,
            rel_path: "".into(),
        })
        .await
        .unwrap()
        .id;

    c.upsert_media(nm(drive_a, "a.jpg", "hash-a", Some(source_a)))
        .await
        .unwrap();
    c.upsert_media(nm(drive_b, "b.jpg", "hash-b", Some(source_b)))
        .await
        .unwrap();
    c.reconcile_missing(drive_a, source_a, &[]).await.unwrap();
    c.reconcile_missing(drive_b, source_b, &[]).await.unwrap();

    let removed = c.remove_missing(drive_a).await.unwrap();
    assert_eq!(removed, 1);
    assert_eq!(c.count_media(Some(drive_a)).await.unwrap(), 0);
    assert_eq!(
        c.count_media(Some(drive_b)).await.unwrap(),
        1,
        "drive B's missing row must be untouched"
    );
}
