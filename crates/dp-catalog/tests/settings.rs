use dp_catalog::{Catalog, SqliteCatalog};
use dp_core::{OrganizeDefaults, PREVIEW_EDGE_MAX};

#[tokio::test]
async fn get_settings_defaults_to_max_preview_edge_when_never_written() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    let settings = c.get_settings().await.unwrap();
    assert_eq!(settings.preview_edge, PREVIEW_EDGE_MAX);
}

#[tokio::test]
async fn set_then_get_round_trips_the_preview_edge() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();

    c.set_preview_edge(800).await.unwrap();

    let settings = c.get_settings().await.unwrap();
    assert_eq!(settings.preview_edge, 800);
}

#[tokio::test]
async fn setting_the_preview_edge_again_overwrites_the_previous_value() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();

    c.set_preview_edge(800).await.unwrap();
    c.set_preview_edge(1200).await.unwrap();

    let settings = c.get_settings().await.unwrap();
    assert_eq!(settings.preview_edge, 1200);
}

#[tokio::test]
async fn thumbs_dir_defaults_to_none_when_never_written() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    assert_eq!(c.get_settings().await.unwrap().thumbs_dir, None);
}

#[tokio::test]
async fn set_then_get_round_trips_the_thumbs_dir() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();

    c.set_thumbs_dir(Some("/Volumes/Cache/drophoto-thumbs"))
        .await
        .unwrap();

    assert_eq!(
        c.get_settings().await.unwrap().thumbs_dir.as_deref(),
        Some("/Volumes/Cache/drophoto-thumbs")
    );
}

#[tokio::test]
async fn clearing_the_thumbs_dir_returns_it_to_none() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();

    c.set_thumbs_dir(Some("/Volumes/Cache/drophoto-thumbs"))
        .await
        .unwrap();
    c.set_thumbs_dir(None).await.unwrap();

    assert_eq!(c.get_settings().await.unwrap().thumbs_dir, None);
}

#[tokio::test]
async fn organize_defaults_are_all_none_when_never_written() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();
    assert_eq!(
        c.get_organize_defaults().await.unwrap(),
        OrganizeDefaults::default()
    );
}

#[tokio::test]
async fn set_then_get_round_trips_the_organize_defaults() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();

    let defaults = OrganizeDefaults {
        root: Some("sorted".into()),
        folder_tpl: Some("{{yyyy}}/{{mm}}".into()),
        file_tpl: Some("{{stem}}".into()),
        keep_pairs: Some(false),
    };
    c.set_organize_defaults(&defaults).await.unwrap();

    assert_eq!(c.get_organize_defaults().await.unwrap(), defaults);
}

#[tokio::test]
async fn setting_the_organize_defaults_again_overwrites_the_previous_value() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();

    c.set_organize_defaults(&OrganizeDefaults {
        root: Some("sorted".into()),
        folder_tpl: Some("{{yyyy}}/{{mm}}".into()),
        file_tpl: Some("{{stem}}".into()),
        keep_pairs: Some(false),
    })
    .await
    .unwrap();

    let updated = OrganizeDefaults {
        root: Some("archive2".into()),
        folder_tpl: Some("{{yyyy}}".into()),
        file_tpl: Some("{{yyyy}}-{{stem}}".into()),
        keep_pairs: Some(true),
    };
    c.set_organize_defaults(&updated).await.unwrap();

    assert_eq!(c.get_organize_defaults().await.unwrap(), updated);
}

#[tokio::test]
async fn clearing_an_organize_default_field_returns_it_to_none() {
    let c = SqliteCatalog::open_in_memory().await.unwrap();

    c.set_organize_defaults(&OrganizeDefaults {
        root: Some("sorted".into()),
        folder_tpl: Some("{{yyyy}}/{{mm}}".into()),
        file_tpl: Some("{{stem}}".into()),
        keep_pairs: Some(false),
    })
    .await
    .unwrap();
    c.set_organize_defaults(&OrganizeDefaults::default())
        .await
        .unwrap();

    assert_eq!(
        c.get_organize_defaults().await.unwrap(),
        OrganizeDefaults::default()
    );
}
