use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, MediaKind, NewDrive, NewMedia};
use sqlx::SqlitePool;

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

fn nm_with_camera(drive_id: i64, rel_path: &str, hash: &str, camera: &str) -> NewMedia {
    NewMedia {
        camera: Some(camera.into()),
        ..nm(drive_id, rel_path, hash)
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
async fn upsert_media_indexes_the_stem() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    c.upsert_media(nm(drive_id, "Pictures/IMG_1234.jpg", "h-a"))
        .await
        .unwrap();

    let found = c.search_media("img_1234", 10).await.unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].0.rel_path, "Pictures/IMG_1234.jpg");

    assert!(c.search_media("nope", 10).await.unwrap().is_empty());
}

#[tokio::test]
async fn tagging_updates_the_index() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();

    assert!(c.search_media("beach", 10).await.unwrap().is_empty());

    c.tag_media(&[a], &["beach".into()], &[]).await.unwrap();
    let found = c.search_media("beach", 10).await.unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].0.id, a);

    let tag_id = c.list_tags().await.unwrap()[0].id;
    c.tag_media(&[a], &[], &[tag_id]).await.unwrap();
    assert!(c.search_media("beach", 10).await.unwrap().is_empty());
}

#[tokio::test]
async fn camera_is_searchable() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c
        .upsert_media(nm_with_camera(drive_id, "a.jpg", "h-a", "Canon EOS R5"))
        .await
        .unwrap();

    let by_canon = c.search_media("canon", 10).await.unwrap();
    assert_eq!(by_canon.len(), 1);
    assert_eq!(by_canon[0].0.id, a);

    let by_r5 = c.search_media("r5", 10).await.unwrap();
    assert_eq!(by_r5.len(), 1);
    assert_eq!(by_r5[0].0.id, a);
}

#[tokio::test]
async fn last_token_is_prefix_matched() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c
        .upsert_media(nm_with_camera(drive_id, "a.jpg", "h-a", "Canon EOS R5"))
        .await
        .unwrap();
    c.tag_media(&[a], &["beach".into()], &[]).await.unwrap();

    let by_prefix = c.search_media("bea", 10).await.unwrap();
    assert_eq!(by_prefix.len(), 1);
    assert_eq!(by_prefix[0].0.id, a);

    // Earlier tokens still require a full match; only the last one is a
    // prefix — "canon bea" should match camera=Canon AND tag beach*.
    let combined = c.search_media("canon bea", 10).await.unwrap();
    assert_eq!(combined.len(), 1);
    assert_eq!(combined[0].0.id, a);
}

#[tokio::test]
async fn delete_media_removes_the_fts_row() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "IMG_5678.jpg", "h-a")).await.unwrap();

    assert_eq!(c.search_media("img_5678", 10).await.unwrap().len(), 1);

    assert!(c.delete_media(a).await.unwrap());
    assert!(c.search_media("img_5678", 10).await.unwrap().is_empty());
}

#[tokio::test]
async fn rebuild_fts_recovers_a_dropped_index() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("catalog.db");
    let c = SqliteCatalog::open(&db_path).await.unwrap();
    let drive_id = drive(&c).await;
    c.upsert_media(nm(drive_id, "IMG_9999.jpg", "h-a")).await.unwrap();

    assert_eq!(c.search_media("img_9999", 10).await.unwrap().len(), 1);

    // Simulate the index having drifted/been dropped out from under the
    // catalog, via a second raw connection to the same file.
    let raw = SqlitePool::connect(&format!("sqlite://{}", db_path.display()))
        .await
        .unwrap();
    sqlx::query("DELETE FROM media_fts").execute(&raw).await.unwrap();
    raw.close().await;

    assert!(c.search_media("img_9999", 10).await.unwrap().is_empty());

    c.rebuild_fts().await.unwrap();
    assert_eq!(c.search_media("img_9999", 10).await.unwrap().len(), 1);
}

#[tokio::test]
async fn search_is_diacritic_insensitive() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    c.tag_media(&[a], &["fête".into()], &[]).await.unwrap();

    let found = c.search_media("fete", 10).await.unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].0.id, a);
}

#[tokio::test]
async fn empty_and_whitespace_queries_return_empty() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();

    assert!(c.search_media("", 10).await.unwrap().is_empty());
    assert!(c.search_media("   ", 10).await.unwrap().is_empty());
}

#[tokio::test]
async fn fts_query_syntax_is_escaped() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();

    // Must not error out as invalid FTS5 syntax — special characters are
    // sanitized out of every token before it reaches the query parser.
    let result = c.search_media("beach\" OR \"x", 10).await.unwrap();
    assert!(result.is_empty());
}
