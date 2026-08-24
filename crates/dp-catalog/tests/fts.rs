use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, MediaKind, NewDrive, NewMedia, NewPlace, PlaceSource};
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

/// The `place` FTS column is `name admin country`, joined from `places`
/// via `media.place_id` — so a media row is searchable by any piece of
/// its place, not just the id.
#[tokio::test]
async fn place_is_searchable_by_name_admin_and_country() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();

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
    c.set_media_place(&[a], Some(place.id)).await.unwrap();

    assert_eq!(c.search_media("lisbon", 10).await.unwrap().len(), 1);
    assert_eq!(c.search_media("lisboa", 10).await.unwrap().len(), 1);
    assert_eq!(c.search_media("portugal", 10).await.unwrap().len(), 1);
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

/// C1: a catalog opened on a file where `media` has rows but `media_fts`
/// is empty (e.g. a previous process crashed mid-rebuild, or the DB
/// predates migration 0006 with no backfill) must notice and backfill
/// the index automatically on `SqliteCatalog::open` — no explicit
/// `rebuild_fts` call required. In-memory can't exercise this: it never
/// outlives the process that opened it, so there's no way to "reopen" it
/// with a drifted index already on disk.
#[tokio::test]
async fn startup_backfills_a_missing_fts_index() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("catalog.db");
    let c = SqliteCatalog::open(&db_path).await.unwrap();
    let drive_id = drive(&c).await;
    c.upsert_media(nm(drive_id, "IMG_7777.jpg", "h-a")).await.unwrap();
    assert_eq!(c.search_media("img_7777", 10).await.unwrap().len(), 1);

    // Simulate `media_fts` having been dropped/emptied out from under a
    // previous process, via a raw connection to the same file.
    let raw = SqlitePool::connect(&format!("sqlite://{}", db_path.display()))
        .await
        .unwrap();
    sqlx::query("DELETE FROM media_fts").execute(&raw).await.unwrap();
    raw.close().await;

    let reopened = SqliteCatalog::open(&db_path).await.unwrap();
    assert_eq!(reopened.search_media("img_7777", 10).await.unwrap().len(), 1);
}

/// I2: a query token gets *split* on separators rather than having them
/// deleted outright, mirroring how FTS5's `unicode61` tokenizer already
/// splits the *indexed* stem on hyphens — so a rel_path like
/// `2025-09-12_IMG_1.jpg` is searchable by its date piece.
#[tokio::test]
async fn hyphenated_terms_match_by_each_piece() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c
        .upsert_media(nm(drive_id, "archive/2025-09-12_IMG_1.jpg", "h-a"))
        .await
        .unwrap();

    let found = c.search_media("2025-09-12", 10).await.unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].0.id, a);
}

/// I2: same splitting behavior for an apostrophe — `l'été` still matches
/// the tag verbatim (split into "l" AND "été"*, both of which the
/// indexed tag also tokenizes into), and diacritic folding still lets
/// the plain-ASCII form find it too.
#[tokio::test]
async fn apostrophized_tag_matches_verbatim_and_diacritic_folded() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let a = c.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
    c.tag_media(&[a], &["l'été".into()], &[]).await.unwrap();

    let by_apostrophe_form = c.search_media("l'été", 10).await.unwrap();
    assert_eq!(by_apostrophe_form.len(), 1);
    assert_eq!(by_apostrophe_form[0].0.id, a);

    let by_ete = c.search_media("ete", 10).await.unwrap();
    assert_eq!(by_ete.len(), 1);
    assert_eq!(by_ete[0].0.id, a);
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
