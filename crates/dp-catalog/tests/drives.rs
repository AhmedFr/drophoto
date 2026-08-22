use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{DriveRole, NewDrive};

fn nd(name: &str) -> NewDrive {
    NewDrive {
        name: name.into(),
        mount_path: format!("/Volumes/{name}"),
        role: DriveRole::Archive,
        capacity: 100,
        free: 40,
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
