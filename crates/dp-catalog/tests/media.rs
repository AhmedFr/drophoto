use chrono::{DateTime, Utc};
use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, MediaKind, NewDrive, NewMedia};

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
    }
}

async fn drive(c: &SqliteCatalog) -> i64 {
    c.register_drive(NewDrive {
        name: "A".into(),
        mount_path: "/Volumes/A".into(),
        role: DriveRole::Archive,
        capacity: 100,
        free: 40,
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
async fn list_media_with_drive_joins_drive_and_keeps_ordering() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = c
        .register_drive(NewDrive {
            name: "Kodachrome".into(),
            mount_path: "/Volumes/Kodachrome".into(),
            role: DriveRole::Archive,
            capacity: 100,
            free: 40,
        })
        .await
        .unwrap()
        .id;

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

    let rows = c.list_media_with_drive(10, 0).await.unwrap();
    assert_eq!(rows.len(), 3);

    let (row0, drive0) = &rows[0];
    assert_eq!(row0.rel_path, "new.jpg");
    assert_eq!(drive0.id, drive_id);
    assert_eq!(drive0.name, "Kodachrome");
    assert!(drive0.online);

    assert_eq!(rows[1].0.rel_path, "old.jpg");
    assert_eq!(rows[2].0.rel_path, "no-date.jpg");
    assert!(rows[2].0.taken_at.is_none());
}

#[tokio::test]
async fn record_scan_error_does_not_error() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    c.record_scan_error(drive_id, "a.jpg", "io", "boom")
        .await
        .unwrap();
}
