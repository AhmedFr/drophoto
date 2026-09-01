use chrono::{DateTime, Utc};
use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{
    DriveRole, MediaKind, MediaMetadata, NewDrive, NewMedia, NewSource, OrganizeItemRow, PlanStatus,
};

fn nm(drive_id: i64, rel_path: &str, hash: &str) -> NewMedia {
    nm_taken(drive_id, rel_path, hash, None)
}

fn nm_taken(drive_id: i64, rel_path: &str, hash: &str, taken_at: Option<DateTime<Utc>>) -> NewMedia {
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
        taken_at,
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
async fn upsert_twice_same_path_updates_single_row() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let id1 = c.upsert_media(nm(drive_id, "a.jpg", "hash1")).await.unwrap();
    let id2 = c.upsert_media(nm(drive_id, "a.jpg", "hash2")).await.unwrap();
    assert_eq!(id1, id2);
    let rows = c.list_media(10, 0).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].hash, "hash2");
}

#[tokio::test]
async fn media_hash_exists_true_and_false() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    c.upsert_media(nm(drive_id, "a.jpg", "hash1")).await.unwrap();
    assert!(c.media_hash_exists("hash1").await.unwrap());
    assert!(!c.media_hash_exists("nope").await.unwrap());
}

#[tokio::test]
async fn count_media_scoped_to_drive() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    c.upsert_media(nm(drive_id, "a.jpg", "hash1")).await.unwrap();
    c.upsert_media(nm(drive_id, "b.jpg", "hash2")).await.unwrap();
    assert_eq!(c.count_media(Some(drive_id)).await.unwrap(), 2);
    assert_eq!(c.count_media(Some(999)).await.unwrap(), 0);
    assert_eq!(c.count_media(None).await.unwrap(), 2);
}

#[tokio::test]
async fn list_media_orders_by_taken_at_desc_with_nulls_last() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let older: DateTime<Utc> = "2020-01-01T00:00:00Z".parse().unwrap();
    let newer: DateTime<Utc> = "2024-06-15T12:00:00Z".parse().unwrap();

    c.upsert_media(nm_taken(drive_id, "no-date.jpg", "h-none", None))
        .await
        .unwrap();
    c.upsert_media(nm_taken(drive_id, "old.jpg", "h-old", Some(older)))
        .await
        .unwrap();
    c.upsert_media(nm_taken(drive_id, "new.jpg", "h-new", Some(newer)))
        .await
        .unwrap();

    let rows = c.list_media(10, 0).await.unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].rel_path, "new.jpg");
    assert_eq!(rows[1].rel_path, "old.jpg");
    assert_eq!(rows[2].rel_path, "no-date.jpg");
    assert!(rows[2].taken_at.is_none());
}

#[tokio::test]
async fn record_scan_error_does_not_error() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    c.record_scan_error(drive_id, "a.jpg", "io", "boom")
        .await
        .unwrap();
}

#[tokio::test]
async fn list_media_without_source_returns_only_unattributed_rows() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let source = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "DCIM".into(),
        })
        .await
        .unwrap();

    let legacy_id = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    c.upsert_media(NewMedia {
        source_id: Some(source.id),
        ..nm(drive_id, "DCIM/b.jpg", "h-b")
    })
    .await
    .unwrap();

    let rows = c.list_media_without_source(drive_id).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, legacy_id);
    assert_eq!(rows[0].rel_path, "a.jpg");
}

#[tokio::test]
async fn delete_media_removes_an_unreferenced_row() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let id = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();

    assert!(c.delete_media(id).await.unwrap());
    assert_eq!(c.count_media(Some(drive_id)).await.unwrap(), 0);
}

/// `list_scan_index` is the incremental-rescan fingerprint query — one row
/// per media row on the drive, with everything `dp_jobs::ScanJob` needs
/// (id, size, mtime, hash) to decide whether a walked file is unchanged.
/// A row written with no `mtime` (predates the column, or never set)
/// round-trips as `None` rather than erroring.
#[tokio::test]
async fn list_scan_index_returns_every_rows_fingerprint() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let src = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "".into(),
        })
        .await
        .unwrap();
    let mtime: DateTime<Utc> = "2026-01-01T00:00:00Z".parse().unwrap();

    let a_id = c
        .upsert_media(NewMedia {
            mtime: Some(mtime),
            source_id: Some(src.id),
            ..nm(drive_id, "a.jpg", "hash-a")
        })
        .await
        .unwrap();
    let b_id = c.upsert_media(nm(drive_id, "b.jpg", "hash-b")).await.unwrap();

    let mut index = c.list_scan_index(drive_id).await.unwrap();
    index.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));

    assert_eq!(index.len(), 2);
    assert_eq!(index[0].id, a_id);
    assert_eq!(index[0].rel_path, "a.jpg");
    assert_eq!(index[0].size, 1234);
    assert_eq!(index[0].mtime, Some(mtime));
    assert_eq!(index[0].hash, "hash-a");
    assert_eq!(
        index[0].source_id,
        Some(src.id),
        "a row's owning source must round-trip"
    );
    assert_eq!(
        index[0].sidecar_mtime, None,
        "a row whose sidecar mtime was never recorded must round-trip as None"
    );

    assert_eq!(index[1].id, b_id);
    assert_eq!(index[1].rel_path, "b.jpg");
    assert_eq!(
        index[1].mtime, None,
        "a row written with no mtime must round-trip as None"
    );
    assert_eq!(
        index[1].source_id, None,
        "a row never attributed to a source must round-trip as None"
    );
}

/// `Catalog::set_sidecar_mtime` is the narrow setter the incremental-rescan
/// skip path (and `SidecarSyncJob`) uses to record "we last looked at this
/// sidecar as of `mtime`" — `list_scan_index` must reflect it afterwards.
#[tokio::test]
async fn set_sidecar_mtime_is_reflected_in_the_scan_index() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let media_id = c.upsert_media(nm(drive_id, "a.jpg", "hash-a")).await.unwrap();

    let index = c.list_scan_index(drive_id).await.unwrap();
    assert_eq!(
        index[0].sidecar_mtime, None,
        "a fresh row must start with no recorded sidecar mtime"
    );

    let sidecar_mtime: DateTime<Utc> = "2026-02-14T09:30:00Z".parse().unwrap();
    c.set_sidecar_mtime(media_id, sidecar_mtime).await.unwrap();

    let index = c.list_scan_index(drive_id).await.unwrap();
    assert_eq!(index[0].sidecar_mtime, Some(sidecar_mtime));
}

#[tokio::test]
async fn list_scan_index_is_scoped_to_the_drive() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_a = drive(&c).await;
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
    c.upsert_media(nm(drive_a, "a.jpg", "hash-a")).await.unwrap();
    c.upsert_media(nm(drive_b, "b.jpg", "hash-b")).await.unwrap();

    let index = c.list_scan_index(drive_a).await.unwrap();
    assert_eq!(index.len(), 1);
    assert_eq!(index[0].rel_path, "a.jpg");
}

#[tokio::test]
async fn list_scan_index_is_empty_for_a_drive_with_no_media() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    assert!(c.list_scan_index(drive_id).await.unwrap().is_empty());
}

/// A row an `organize_items` row still points at is deliberately left in
/// place: deleting it would strand that job's history and make the job
/// un-revertable. `organize_items.media_id` carries no foreign key, so
/// the guard has to live in the statement itself.
#[tokio::test]
async fn delete_media_keeps_a_row_an_organize_item_references() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let id = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
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

    assert!(!c.delete_media(id).await.unwrap());
    assert_eq!(c.count_media(Some(drive_id)).await.unwrap(), 1);
}

/// A freshly-upserted row (predating `meta_read_at`, or simply never
/// backfilled) must round-trip through `list_scan_index` as `None` — the
/// incremental-rescan metadata-backfill path's trigger for "this row still
/// needs its metadata read".
#[tokio::test]
async fn list_scan_index_reports_no_meta_read_at_for_a_fresh_row() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    c.upsert_media(nm(drive_id, "a.jpg", "hash-a")).await.unwrap();

    let index = c.list_scan_index(drive_id).await.unwrap();
    assert_eq!(index.len(), 1);
    assert_eq!(index[0].meta_read_at, None);
}

/// `Catalog::update_media_metadata` is the narrow setter the
/// incremental-rescan metadata-backfill path (and the full-processing
/// path, right after a successful metadata read) uses: it must land every
/// `MediaMetadata` field plus `meta_read_at`, and leave every other column
/// (`hash`/`size`/`rel_path`/...) untouched.
#[tokio::test]
async fn update_media_metadata_lands_every_field_and_sets_meta_read_at() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let id = c.upsert_media(nm(drive_id, "a.jpg", "hash-a")).await.unwrap();

    let taken_at: DateTime<Utc> = "2026-03-01T10:00:00Z".parse().unwrap();
    let read_at: DateTime<Utc> = "2026-03-02T11:00:00Z".parse().unwrap();
    let metadata = MediaMetadata {
        width: Some(4000),
        height: Some(3000),
        duration_ms: None,
        taken_at: Some(taken_at),
        camera: Some("Canon EOS R5".into()),
        lens: Some("RF 24-70mm".into()),
        aperture: Some(2.8),
        shutter: Some(0.01),
        iso: Some(400),
        focal_mm: Some(50.0),
        lat: Some(37.7749),
        lon: Some(-122.4194),
    };

    c.update_media_metadata(id, &metadata, read_at).await.unwrap();

    let rows = c.list_media(10, 0).await.unwrap();
    let row = rows.iter().find(|r| r.id == id).unwrap();
    assert_eq!(row.width, Some(4000));
    assert_eq!(row.height, Some(3000));
    assert_eq!(row.taken_at, Some(taken_at));
    assert_eq!(row.camera.as_deref(), Some("Canon EOS R5"));
    assert_eq!(row.lens.as_deref(), Some("RF 24-70mm"));
    assert_eq!(row.aperture, Some(2.8));
    assert_eq!(row.shutter, Some(0.01));
    assert_eq!(row.iso, Some(400));
    assert_eq!(row.focal_mm, Some(50.0));
    assert_eq!(row.lat, Some(37.7749));
    assert_eq!(row.lon, Some(-122.4194));
    // Untouched columns must survive exactly as upserted.
    assert_eq!(row.rel_path, "a.jpg");
    assert_eq!(row.hash, "hash-a");

    let index = c.list_scan_index(drive_id).await.unwrap();
    assert_eq!(index[0].meta_read_at, Some(read_at));
}

/// `update_media_metadata` syncs FTS the same way `upsert_media` does —
/// searching by the newly-set camera must find the row.
#[tokio::test]
async fn update_media_metadata_makes_the_new_camera_searchable() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let id = c.upsert_media(nm(drive_id, "a.jpg", "hash-a")).await.unwrap();
    assert!(c.search_media("Nikon", 10).await.unwrap().is_empty());

    let metadata = MediaMetadata {
        camera: Some("Nikon Z9".into()),
        ..MediaMetadata::default()
    };
    let read_at: DateTime<Utc> = "2026-03-02T11:00:00Z".parse().unwrap();
    c.update_media_metadata(id, &metadata, read_at).await.unwrap();

    let found = c.search_media("Nikon", 10).await.unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].0.id, id);
}
