use chrono::{DateTime, TimeZone, Utc};
use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, MediaKind, NewDrive, NewMedia};

async fn new_catalog() -> SqliteCatalog {
    SqliteCatalog::open_in_memory().await.unwrap()
}

async fn insert_drive(cat: &SqliteCatalog, name: &str) -> i64 {
    cat.register_drive(NewDrive {
        name: name.into(),
        mount_path: format!("/Volumes/{name}"),
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

/// Inserts a media row on `drive_id` at `rel_path` with the given
/// `taken_at` (`None` to leave it undated).
async fn insert_media(
    cat: &SqliteCatalog,
    drive_id: i64,
    rel_path: &str,
    taken_at: Option<DateTime<Utc>>,
) -> i64 {
    cat.upsert_media(NewMedia {
        drive_id,
        rel_path: rel_path.into(),
        hash: format!("hash-{rel_path}"),
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
    })
    .await
    .unwrap()
}

fn exif_date() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2023, 5, 1, 12, 0, 0).unwrap()
}

#[tokio::test]
async fn set_taken_at_bulk_fills_only_null_dates() {
    let cat = new_catalog().await;
    let drive = insert_drive(&cat, "D").await;
    let undated = insert_media(&cat, drive, "IMG-20240816-WA0010.jpg", None).await;
    let dated = insert_media(&cat, drive, "kept.jpg", Some(exif_date())).await;

    assert_eq!(cat.count_undated().await.unwrap(), 1);

    let recovered = Utc.with_ymd_and_hms(2024, 8, 16, 0, 0, 0).unwrap();
    let changed = cat
        .set_taken_at_bulk(&[(undated, recovered), (dated, recovered)])
        .await
        .unwrap();

    // Only the NULL row is written — the EXIF date is never overwritten.
    assert_eq!(changed, 1);
    assert_eq!(
        cat.get_media_with_drive(undated).await.unwrap().0.taken_at,
        Some(recovered)
    );
    assert_eq!(
        cat.get_media_with_drive(dated).await.unwrap().0.taken_at,
        Some(exif_date())
    );
    assert_eq!(cat.count_undated().await.unwrap(), 0);
}

#[tokio::test]
async fn list_undated_returns_id_and_path() {
    let cat = new_catalog().await;
    let drive = insert_drive(&cat, "D").await;
    let id = insert_media(&cat, drive, "sub/IMG-20240816-WA0010.jpg", None).await;
    insert_media(&cat, drive, "dated.jpg", Some(exif_date())).await;

    let rows = cat.list_undated(100).await.unwrap();
    assert_eq!(rows, vec![(id, "sub/IMG-20240816-WA0010.jpg".to_string())]);
}

#[tokio::test]
async fn set_taken_at_bulk_is_a_noop_on_an_empty_slice() {
    let cat = new_catalog().await;
    assert_eq!(cat.set_taken_at_bulk(&[]).await.unwrap(), 0);
}

#[tokio::test]
async fn count_undated_is_zero_when_nothing_is_undated() {
    let cat = new_catalog().await;
    let drive = insert_drive(&cat, "D").await;
    insert_media(&cat, drive, "dated.jpg", Some(exif_date())).await;
    assert_eq!(cat.count_undated().await.unwrap(), 0);
}
