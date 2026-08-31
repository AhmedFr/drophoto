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

/// The RELINK action's core guarantee (review finding 4): unlike
/// `backfill_drive_volume_identity`, `relink_drive` overwrites a stale
/// identity outright — and the overwritten identity is then genuinely
/// usable by `resolve_presence`, not just present in the raw columns.
/// This is the exact scenario the field report described: a drive
/// registered before identity columns existed (`volume_uuid`/
/// `volume_label` both `NULL`), whose display name no longer matches any
/// mounted volume, and whose `mount_path` was nulled while offline — so
/// none of the four match tiers can ever re-attach it — is relinked to
/// the volume the user actually points at, and a subsequent
/// `resolve_presence` call matches it by uuid, the strongest tier.
#[tokio::test]
async fn relink_overwrites_stale_identity_and_a_subsequent_resolve_matches_by_uuid() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let d = c.register_drive(nd("SSD Samsung T7")).await.unwrap();
    // Simulate the drive going offline, same as `set_drive_presence`
    // nulling `mount_path` — none of the tiers can find it now.
    c.set_drive_presence(d.id, None, None).await.unwrap();

    c.relink_drive(d.id, Some("uuid-real"), Some("T7"), "/Volumes/T7", Some(123))
        .await
        .unwrap();

    let reloaded = c.list_drives().await.unwrap().into_iter().next().unwrap();
    assert_eq!(
        reloaded.id, d.id,
        "relink must preserve the row's id, not create a new one"
    );
    assert_eq!(reloaded.volume_uuid, Some("uuid-real".to_string()));
    assert_eq!(reloaded.volume_label, Some("T7".to_string()));
    assert_eq!(reloaded.mount_path, Some("/Volumes/T7".to_string()));
    assert_eq!(reloaded.free, 123);
    assert!(reloaded.online);

    let volume = dp_core::Volume {
        name: "T7".into(),
        mount_path: "/Volumes/T7".into(),
        total_bytes: 1_000,
        free_bytes: 123,
        is_removable: true,
        uuid: Some("uuid-real".into()),
    };
    let resolved = dp_volumes::resolve_presence(&[reloaded], &[volume]);
    assert_eq!(resolved[0].mount_path, Some("/Volumes/T7".to_string()));
    assert_eq!(resolved[0].volume_uuid, Some("uuid-real".to_string()));
}

/// `relink_drive` must overwrite an already-set identity too — the
/// deliberate difference from `backfill_drive_volume_identity`'s
/// COALESCE rule, for the case where the drive's *stored* identity
/// itself is wrong (not just missing) and the user is correcting it.
#[tokio::test]
async fn relink_overwrites_an_already_set_identity() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let d = c
        .register_drive(NewDrive {
            volume_uuid: Some("stale-uuid".into()),
            volume_label: Some("Stale Label".into()),
            ..nd("A")
        })
        .await
        .unwrap();

    c.relink_drive(
        d.id,
        Some("fresh-uuid"),
        Some("Fresh Label"),
        "/Volumes/Fresh",
        None,
    )
    .await
    .unwrap();

    let reloaded = c.list_drives().await.unwrap().into_iter().next().unwrap();
    assert_eq!(reloaded.volume_uuid, Some("fresh-uuid".to_string()));
    assert_eq!(reloaded.volume_label, Some("Fresh Label".to_string()));
    assert_eq!(reloaded.mount_path, Some("/Volumes/Fresh".to_string()));
}

#[tokio::test]
async fn relink_with_no_free_leaves_free_untouched() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let d = c.register_drive(nd("A")).await.unwrap();
    assert_eq!(d.free, 40);

    c.relink_drive(d.id, None, None, "/Volumes/A", None)
        .await
        .unwrap();

    let reloaded = c.list_drives().await.unwrap().into_iter().next().unwrap();
    assert_eq!(reloaded.free, 40);
}
