use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, MediaKind, NewDrive, NewMedia};

fn nm(drive_id: i64, rel_path: &str, hash: &str) -> NewMedia {
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
async fn record_scan_error_does_not_error() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    c.record_scan_error(drive_id, "a.jpg", "io", "boom")
        .await
        .unwrap();
}
