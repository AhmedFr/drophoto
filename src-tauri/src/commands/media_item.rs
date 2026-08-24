use dp_core::{Drive, MediaItem, MediaRow};
use dp_thumbs::ThumbStore;
use std::path::Path;

/// Maps a catalog row plus its owning drive into the `MediaItem` shape sent
/// to the frontend: thumbnail/preview paths resolved through `store`, and
/// `original_path` — the file's absolute path on disk — present only when
/// the drive is currently mounted.
pub fn to_item(store: &ThumbStore, row: MediaRow, drive: Drive) -> MediaItem {
    let original_path = drive
        .mount_path
        .map(|m| Path::new(&m).join(&row.rel_path).to_string_lossy().into_owned());
    let has_thumb = store.exists(&row.hash, 400);

    MediaItem {
        thumb_path: store.path(&row.hash, 400).to_string_lossy().into_owned(),
        preview_path: store.path(&row.hash, 2000).to_string_lossy().into_owned(),
        drive_name: drive.name,
        online: drive.online,
        original_path,
        has_thumb,
        row,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dp_core::{DriveRole, MediaKind};

    fn row() -> MediaRow {
        MediaRow {
            id: 1,
            drive_id: 1,
            rel_path: "photos/1.jpg".into(),
            hash: "abc123".into(),
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
            missing_at: None,
            organized_at: None,
            source_id: None,
            sidecar_pending: false,
        }
    }

    fn drive(mount_path: Option<&str>, online: bool) -> Drive {
        Drive {
            id: 1,
            name: "Kodachrome".into(),
            volume_uuid: None,
            mount_path: mount_path.map(String::from),
            role: DriveRole::Source,
            capacity: 100,
            free: 40,
            last_seen_at: None,
            online,
        }
    }

    #[test]
    fn resolves_thumb_and_preview_paths_under_the_store_root() {
        let dir = tempfile::tempdir().unwrap();
        let store = ThumbStore::new(dir.path());

        let item = to_item(&store, row(), drive(Some("/Volumes/Kodachrome"), true));

        assert_eq!(
            item.thumb_path,
            dir.path().join("abc123").join("400.webp").to_string_lossy()
        );
        assert_eq!(
            item.preview_path,
            dir.path().join("abc123").join("2000.webp").to_string_lossy()
        );
    }

    #[test]
    fn original_path_is_some_when_the_drive_is_mounted() {
        let dir = tempfile::tempdir().unwrap();
        let store = ThumbStore::new(dir.path());

        let item = to_item(&store, row(), drive(Some("/Volumes/Kodachrome"), true));

        assert_eq!(
            item.original_path,
            Some("/Volumes/Kodachrome/photos/1.jpg".to_string())
        );
    }

    #[test]
    fn original_path_is_none_when_the_drive_has_no_mount_path() {
        let dir = tempfile::tempdir().unwrap();
        let store = ThumbStore::new(dir.path());

        let item = to_item(&store, row(), drive(None, false));

        assert_eq!(item.original_path, None);
    }

    #[test]
    fn has_thumb_is_false_when_no_thumbnail_was_ever_written() {
        let dir = tempfile::tempdir().unwrap();
        let store = ThumbStore::new(dir.path());

        let item = to_item(&store, row(), drive(Some("/Volumes/Kodachrome"), true));

        assert!(!item.has_thumb);
    }

    #[test]
    fn has_thumb_is_true_when_a_400px_thumbnail_exists_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let store = ThumbStore::new(dir.path());
        let thumb_path = store.path("abc123", 400);
        std::fs::create_dir_all(thumb_path.parent().unwrap()).unwrap();
        std::fs::write(&thumb_path, b"fake webp bytes").unwrap();

        let item = to_item(&store, row(), drive(Some("/Volumes/Kodachrome"), true));

        assert!(item.has_thumb);
    }
}
