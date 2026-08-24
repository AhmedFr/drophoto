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
        organized_at: None,
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
    })
    .await
    .unwrap()
    .id
}

#[tokio::test]
async fn tag_media_creates_links_and_marks_pending() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    let b = c.upsert_media(nm(drive_id, "b.jpg", "h-b")).await.unwrap();

    c.tag_media(&[a, b], &["Trip".into(), "beach".into()], &[])
        .await
        .unwrap();

    let tags = c.list_tags().await.unwrap();
    assert_eq!(tags.len(), 2);

    let for_a = c.tags_for_media(&[a]).await.unwrap();
    let names: Vec<&str> = for_a.iter().map(|(_, t)| t.name.as_str()).collect();
    assert_eq!(names, vec!["beach", "Trip"]);

    let pending = c.list_sidecar_pending(drive_id).await.unwrap();
    assert_eq!(pending.len(), 2);
}

#[tokio::test]
async fn tag_media_is_name_case_insensitive() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();

    c.tag_media(&[a], &["Beach".into()], &[]).await.unwrap();
    c.tag_media(&[a], &["beach".into()], &[]).await.unwrap();

    let tags = c.list_tags().await.unwrap();
    assert_eq!(tags.len(), 1);

    let for_a = c.tags_for_media(&[a]).await.unwrap();
    assert_eq!(for_a.len(), 1);
}

#[tokio::test]
async fn tag_media_remove_unlinks_and_marks_pending() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();

    c.tag_media(&[a], &["Trip".into()], &[]).await.unwrap();
    let tag_id = c.list_tags().await.unwrap()[0].id;

    c.clear_sidecar_pending(a).await.unwrap();

    c.tag_media(&[a], &[], &[tag_id]).await.unwrap();

    let for_a = c.tags_for_media(&[a]).await.unwrap();
    assert!(for_a.is_empty());

    let pending = c.list_sidecar_pending(drive_id).await.unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, a);
}

#[tokio::test]
async fn tag_media_noop_does_not_mark_pending() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();

    c.tag_media(&[a], &["Trip".into()], &[]).await.unwrap();
    c.clear_sidecar_pending(a).await.unwrap();

    // Adding an already-linked tag is a no-op.
    c.tag_media(&[a], &["Trip".into()], &[]).await.unwrap();
    assert!(c.list_sidecar_pending(drive_id).await.unwrap().is_empty());

    // Removing a tag id that was never linked is a no-op.
    c.tag_media(&[a], &[], &[999_999]).await.unwrap();
    assert!(c.list_sidecar_pending(drive_id).await.unwrap().is_empty());
}

#[tokio::test]
async fn clear_sidecar_pending_clears_one_row() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();

    c.tag_media(&[a], &["Trip".into()], &[]).await.unwrap();
    assert_eq!(c.list_sidecar_pending(drive_id).await.unwrap().len(), 1);

    c.clear_sidecar_pending(a).await.unwrap();
    assert!(c.list_sidecar_pending(drive_id).await.unwrap().is_empty());
}

#[tokio::test]
async fn tags_for_media_empty_ids_returns_empty() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let result = c.tags_for_media(&[]).await.unwrap();
    assert!(result.is_empty());
}

#[tokio::test]
async fn tag_names_for_media_orders_by_name() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    c.tag_media(&[a], &["Trip".into(), "beach".into()], &[])
        .await
        .unwrap();

    let names = c.tag_names_for_media(a).await.unwrap();
    assert_eq!(names, vec!["beach", "Trip"]);
}

#[tokio::test]
async fn mark_sidecar_pending_sets_the_flag() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();

    c.mark_sidecar_pending(a).await.unwrap();

    let pending = c.list_sidecar_pending(drive_id).await.unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, a);
}

#[tokio::test]
async fn has_sidecar_pending_reports_whether_any_row_is_flagged() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h1")).await.unwrap();

    assert!(!c.has_sidecar_pending(drive_id).await.unwrap());

    c.tag_media(&[a], &["x".into()], &[]).await.unwrap();
    assert!(c.has_sidecar_pending(drive_id).await.unwrap());

    c.clear_sidecar_pending(a).await.unwrap();
    assert!(!c.has_sidecar_pending(drive_id).await.unwrap());
}

#[tokio::test]
async fn has_sidecar_pending_is_scoped_to_one_drive() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let other_id = c
        .register_drive(NewDrive {
            name: "B".into(),
            mount_path: "/Volumes/B".into(),
            role: DriveRole::Archive,
            capacity: 100,
            free: 40,
        })
        .await
        .unwrap()
        .id;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h1")).await.unwrap();
    c.tag_media(&[a], &["x".into()], &[]).await.unwrap();

    assert!(c.has_sidecar_pending(drive_id).await.unwrap());
    assert!(!c.has_sidecar_pending(other_id).await.unwrap());
}
