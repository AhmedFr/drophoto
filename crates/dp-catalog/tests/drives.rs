use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, NewDrive};

fn nd(name: &str) -> NewDrive {
    NewDrive {
        name: name.into(),
        mount_path: format!("/Volumes/{name}"),
        role: DriveRole::Archive,
        capacity: 100,
        free: 40,
        volume_uuid: None,
        volume_label: None,
    }
}

#[tokio::test]
async fn register_and_list() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let d = c.register_drive(nd("Kodachrome")).await.unwrap();
    assert_eq!(d.name, "Kodachrome");
    assert!(d.online);
    assert_eq!(c.list_drives().await.unwrap().len(), 1);
}

#[tokio::test]
async fn duplicate_name_is_db_error() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    c.register_drive(nd("A")).await.unwrap();
    assert!(matches!(
        c.register_drive(nd("A")).await,
        Err(dp_core::DpError::Db { .. })
    ));
}

#[tokio::test]
async fn presence_toggles_online() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let d = c.register_drive(nd("A")).await.unwrap();
    c.set_drive_presence(d.id, None, None).await.unwrap();
    assert!(!c.list_drives().await.unwrap()[0].online);
}

/// `register_drive` captures the VOLUME's own uuid/label independently of
/// `name` (the user-chosen display label) — the root cause of the
/// field-reported bug this task fixes: a drive renamed at registration
/// used to only ever be matched by `name`, so reconnecting it looked like
/// a brand-new volume.
#[tokio::test]
async fn register_drive_captures_volume_identity_independent_of_display_name() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let d = c
        .register_drive(NewDrive {
            name: "My Backup Drive".into(),
            mount_path: "/Volumes/Kodachrome".into(),
            role: DriveRole::Archive,
            capacity: 100,
            free: 40,
            volume_uuid: Some("uuid-1".into()),
            volume_label: Some("Kodachrome".into()),
        })
        .await
        .unwrap();

    assert_eq!(d.name, "My Backup Drive");
    assert_eq!(d.volume_uuid, Some("uuid-1".to_string()));
    assert_eq!(d.volume_label, Some("Kodachrome".to_string()));
}

#[tokio::test]
async fn register_drive_allows_no_volume_identity() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let d = c.register_drive(nd("A")).await.unwrap();
    assert_eq!(d.volume_uuid, None);
    assert_eq!(d.volume_label, None);
}

#[tokio::test]
async fn backfill_fills_null_identity_columns() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let d = c.register_drive(nd("A")).await.unwrap();
    assert_eq!(d.volume_uuid, None);

    c.backfill_drive_volume_identity(d.id, Some("uuid-x"), Some("A"))
        .await
        .unwrap();

    let reloaded = c.list_drives().await.unwrap().into_iter().next().unwrap();
    assert_eq!(reloaded.volume_uuid, Some("uuid-x".to_string()));
    assert_eq!(reloaded.volume_label, Some("A".to_string()));
}

/// The `COALESCE` in the backfill query must never overwrite an already
/// set value — a legacy row backfilled once must stay backfilled even if
/// the matched volume's own identity later reads slightly differently
/// (e.g. transient diskutil read failure yielding `None`).
#[tokio::test]
async fn backfill_never_overwrites_an_already_set_identity() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let d = c
        .register_drive(NewDrive {
            volume_uuid: Some("original-uuid".into()),
            volume_label: Some("Original Label".into()),
            ..nd("A")
        })
        .await
        .unwrap();

    c.backfill_drive_volume_identity(d.id, Some("different-uuid"), Some("Different Label"))
        .await
        .unwrap();

    let reloaded = c.list_drives().await.unwrap().into_iter().next().unwrap();
    assert_eq!(reloaded.volume_uuid, Some("original-uuid".to_string()));
    assert_eq!(reloaded.volume_label, Some("Original Label".to_string()));
}

#[tokio::test]
async fn backfill_with_none_leaves_null_columns_null() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let d = c.register_drive(nd("A")).await.unwrap();

    c.backfill_drive_volume_identity(d.id, None, None).await.unwrap();

    let reloaded = c.list_drives().await.unwrap().into_iter().next().unwrap();
    assert_eq!(reloaded.volume_uuid, None);
    assert_eq!(reloaded.volume_label, None);
}
