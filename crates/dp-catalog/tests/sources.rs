use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, MediaKind, NewDrive, NewMedia, NewSource};

async fn drive(c: &SqliteCatalog) -> i64 {
    c.register_drive(NewDrive {
        name: "A".into(),
        mount_path: "/Volumes/A".into(),
        role: DriveRole::Source,
        capacity: 100,
        free: 40,
    })
    .await
    .unwrap()
    .id
}

fn nm(drive_id: i64, rel_path: &str, hash: &str, source_id: Option<i64>) -> NewMedia {
    NewMedia {
        drive_id,
        rel_path: rel_path.into(),
        hash: hash.into(),
        size: 1,
        kind: MediaKind::Photo,
        ext: "jpg".into(),
        width: None,
        height: None,
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
        source_id,
    }
}

#[tokio::test]
async fn upsert_source_inserts_a_new_enabled_source() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let s = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "DCIM".into(),
        })
        .await
        .unwrap();

    assert_eq!(s.drive_id, drive_id);
    assert_eq!(s.rel_path, "DCIM");
    assert!(s.enabled);
}

#[tokio::test]
async fn upsert_source_is_idempotent_and_reenables_a_disabled_source() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let first = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "DCIM".into(),
        })
        .await
        .unwrap();
    c.set_source_enabled(first.id, false).await.unwrap();

    let again = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "DCIM".into(),
        })
        .await
        .unwrap();

    assert_eq!(again.id, first.id, "must not create a duplicate row");
    assert!(again.enabled, "upsert must re-enable a disabled source");

    let all = c.list_sources(drive_id).await.unwrap();
    assert_eq!(all.len(), 1);
}

#[tokio::test]
async fn list_sources_returns_every_source_regardless_of_enabled_state() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let a = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "DCIM".into(),
        })
        .await
        .unwrap();
    c.upsert_source(NewSource {
        drive_id,
        rel_path: "Pictures".into(),
    })
    .await
    .unwrap();
    c.set_source_enabled(a.id, false).await.unwrap();

    let all = c.list_sources(drive_id).await.unwrap();
    assert_eq!(all.len(), 2);
}

#[tokio::test]
async fn list_enabled_sources_excludes_disabled_ones() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let a = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "DCIM".into(),
        })
        .await
        .unwrap();
    c.upsert_source(NewSource {
        drive_id,
        rel_path: "Pictures".into(),
    })
    .await
    .unwrap();
    c.set_source_enabled(a.id, false).await.unwrap();

    let enabled = c.list_enabled_sources(drive_id).await.unwrap();
    assert_eq!(enabled.len(), 1);
    assert_eq!(enabled[0].rel_path, "Pictures");
}

#[tokio::test]
async fn delete_source_removes_it() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let s = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "DCIM".into(),
        })
        .await
        .unwrap();
    c.delete_source(s.id).await.unwrap();

    assert!(c.list_sources(drive_id).await.unwrap().is_empty());
}

#[tokio::test]
async fn count_media_without_source_counts_only_null_source_id_rows() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let source = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "DCIM".into(),
        })
        .await
        .unwrap();

    c.upsert_media(nm(drive_id, "a.jpg", "h-a", None)).await.unwrap();
    c.upsert_media(nm(drive_id, "b.jpg", "h-b", Some(source.id)))
        .await
        .unwrap();

    assert_eq!(c.count_media_without_source(drive_id).await.unwrap(), 1);
}

#[tokio::test]
async fn upsert_source_rejects_a_parent_dir_component() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let err = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "../x".into(),
        })
        .await
        .unwrap_err();
    assert!(matches!(err, dp_core::DpError::Unsupported { .. }), "got {err:?}");
}

#[tokio::test]
async fn upsert_source_rejects_an_absolute_path() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let err = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "/etc".into(),
        })
        .await
        .unwrap_err();
    assert!(matches!(err, dp_core::DpError::Unsupported { .. }), "got {err:?}");
}

#[tokio::test]
async fn upsert_source_normalizes_leading_dot_slash_and_trailing_slash() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let s = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "./DCIM/".into(),
        })
        .await
        .unwrap();
    assert_eq!(s.rel_path, "DCIM");
}

#[tokio::test]
async fn upsert_source_normalizes_double_slash() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let s = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "DCIM//a".into(),
        })
        .await
        .unwrap();
    assert_eq!(s.rel_path, "DCIM/a");
}

#[tokio::test]
async fn upsert_source_allows_the_empty_mount_root_path() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;

    let s = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "".into(),
        })
        .await
        .unwrap();
    assert_eq!(s.rel_path, "");
}

/// `upsert_media`'s `ON CONFLICT` clause is `source_id =
/// COALESCE(excluded.source_id, media.source_id)` — re-scanning a file
/// without a source attribution (e.g. a raw upsert that doesn't know
/// which source it came from) must not clobber a `source_id` that was
/// already recorded for it.
#[tokio::test]
async fn reupserting_media_with_source_id_none_keeps_the_previously_recorded_source_id() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let drive_id = drive(&c).await;
    let source = c
        .upsert_source(NewSource {
            drive_id,
            rel_path: "DCIM".into(),
        })
        .await
        .unwrap();

    c.upsert_media(nm(drive_id, "DCIM/a.jpg", "h-a", Some(source.id)))
        .await
        .unwrap();
    c.upsert_media(nm(drive_id, "DCIM/a.jpg", "h-a2", None))
        .await
        .unwrap();

    let rows = c.list_media(10, 0).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].hash, "h-a2", "the rest of the row must still update");
    assert_eq!(
        rows[0].source_id,
        Some(source.id),
        "a None source_id on re-upsert must not clear the existing one"
    );
}
