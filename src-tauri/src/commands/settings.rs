use crate::state::AppState;
use dp_core::{
    AppSettings, DpError, DpResult, StorageUsage, PREVIEW_EDGE_BALANCED, PREVIEW_EDGE_COMPACT,
    PREVIEW_EDGE_MAX,
};
use dp_jobs::{Job, RegenDeps, RegenJob};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;

/// The only edges `set_preview_quality` accepts — the three steps the UI
/// offers (Compact/Balanced/Max). Rejecting anything else keeps the
/// stored setting always meaningful: an off-step value would match no
/// `QualityPicker` radio (rendering with nothing selected) and would make
/// `render_edge_for_slot`'s output an arbitrary, never-offered pixel size.
const ALLOWED_PREVIEW_EDGES: [u32; 3] = [PREVIEW_EDGE_COMPACT, PREVIEW_EDGE_BALANCED, PREVIEW_EDGE_MAX];

/// The two filenames written into each thumb-store hash directory — see
/// `dp_thumbs::THUMB_SLOT`/`PREVIEW_SLOT`. Named directly rather than
/// imported, since [`compute_storage_usage`] only ever needs the plain
/// filename to bucket a walked entry, not the slot/hash path-building
/// dp-thumbs otherwise owns.
const THUMB_400_FILENAME: &str = "400.webp";
const PREVIEW_FILENAME: &str = "2000.webp";

/// Current app-wide settings (currently just the preview-quality edge).
#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, DpError> {
    state.catalog.get_settings().await
}

/// Persists the preview-quality edge (px) — must be one of
/// [`ALLOWED_PREVIEW_EDGES`], or this refuses with [`DpError::Unsupported`]
/// rather than silently storing an arbitrary value. Setting a lower edge
/// doesn't regenerate anything on its own — the frontend derives whether
/// a regen is worth offering from `settings.preview_edge` itself (see
/// `useSettingsData`) and calls `start_regen_previews` separately. Setting
/// a higher edge never recovers already-downscaled previews by itself
/// either: that needs a full rescan with the originals available (see
/// `ScanJob::with_full`).
#[tauri::command]
pub async fn set_preview_quality(state: State<'_, AppState>, edge: u32) -> Result<(), DpError> {
    validate_preview_edge(edge)?;
    state.catalog.set_preview_edge(edge).await
}

/// `Ok(())` when `edge` is one of [`ALLOWED_PREVIEW_EDGES`],
/// `Err(DpError::Unsupported)` otherwise — factored out of
/// [`set_preview_quality`] so the validation itself is unit-testable
/// without a real `AppState`.
fn validate_preview_edge(edge: u32) -> DpResult<()> {
    if ALLOWED_PREVIEW_EDGES.contains(&edge) {
        Ok(())
    } else {
        Err(DpError::Unsupported {
            message: format!("invalid preview quality edge {edge}; must be one of {ALLOWED_PREVIEW_EDGES:?}"),
            path: None,
        })
    }
}

/// A breakdown of the app's own on-disk footprint (thumbnails + catalog)
/// for Settings' storage panel — never the user's photos/drives. Runs the
/// actual directory walk on `spawn_blocking`, since it stats every
/// thumbnail file under the store root.
#[tauri::command]
pub async fn storage_usage(state: State<'_, AppState>) -> Result<StorageUsage, DpError> {
    let thumbs_root = state.store.root().to_path_buf();
    let catalog_path = state.app_data_dir.join("catalog.db");

    tokio::task::spawn_blocking(move || compute_storage_usage(&thumbs_root, &catalog_path))
        .await
        .map_err(|e| DpError::Io {
            message: format!("storage usage task failed: {e}"),
            path: None,
        })?
}

/// Starts (or reuses, if one is already running) the global preview-regen
/// sweep, targeting the *currently configured* preview edge — see
/// [`dp_jobs::RegenJob`].
#[tauri::command]
pub async fn start_regen_previews(state: State<'_, AppState>) -> Result<String, DpError> {
    let settings = state.catalog.get_settings().await?;
    let deps = RegenDeps {
        store: state.store.clone(),
    };
    state.start_regen(move |job_id| {
        Arc::new(RegenJob::new(job_id, settings.preview_edge, deps)) as Arc<dyn Job>
    })
}

/// Danger-zone action: permanently deletes the app's own catalog and
/// cached thumbnails, then exits the process (a relaunch starts fresh).
/// NEVER touches the user's photos, drives, or `.xmp` sidecar files —
/// [`reset_app_data_at`] only ever deletes `catalog.db*` and `thumbs/`
/// inside the app's own data directory, nothing else, and nothing outside
/// it. Uses `state.app_data_dir` (resolved once at startup, in
/// `AppState::init`) rather than re-resolving it here — one less place
/// that could, even in principle, disagree with what `storage_usage`
/// computed against. Nothing cancels an in-flight scan/regen job first;
/// harmless in practice since `exit(0)` follows immediately and a
/// half-finished write left behind is cleaned up by the delete anyway.
#[tauri::command]
pub async fn reset_app_data(state: State<'_, AppState>) -> Result<(), DpError> {
    reset_app_data_at(&state.app_data_dir)?;
    std::process::exit(0);
}

/// The actual deletion [`reset_app_data`] performs, factored out so it can
/// be unit-tested against a temp directory — never the real app-data path.
/// Deletes `catalog.db` plus its `-wal`/`-shm` siblings (if present, WAL
/// mode) and the whole `thumbs/` directory, all directly under `dir`.
/// Missing files/directories are silently skipped rather than erroring —
/// a partial or already-reset app-data dir is a normal, safe starting
/// point, not a failure.
fn reset_app_data_at(dir: &Path) -> DpResult<()> {
    for suffix in ["", "-wal", "-shm"] {
        let path = dir.join(format!("catalog.db{suffix}"));
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| DpError::io(&e, path.display().to_string()))?;
        }
    }

    let thumbs = dir.join("thumbs");
    if thumbs.exists() {
        std::fs::remove_dir_all(&thumbs).map_err(|e| DpError::io(&e, thumbs.display().to_string()))?;
    }

    Ok(())
}

/// Walks `thumbs_root` (one level of hash directories, each holding at
/// most a `400.webp` and a `2000.webp`) summing bytes by filename, then
/// adds `catalog_path`'s size plus its `-wal`/`-shm` siblings when
/// present. Synchronous — always called from inside `spawn_blocking`.
fn compute_storage_usage(thumbs_root: &Path, catalog_path: &Path) -> DpResult<StorageUsage> {
    let mut thumbs_400_bytes = 0u64;
    let mut previews_bytes = 0u64;
    let mut file_count = 0u64;

    if thumbs_root.exists() {
        let hash_dirs =
            std::fs::read_dir(thumbs_root).map_err(|e| DpError::io(&e, thumbs_root.display().to_string()))?;
        for hash_dir in hash_dirs {
            let hash_dir = hash_dir.map_err(|e| DpError::io(&e, thumbs_root.display().to_string()))?;
            if !hash_dir.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let entries = match std::fs::read_dir(hash_dir.path()) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let Ok(meta) = entry.metadata() else { continue };
                if !meta.is_file() {
                    continue;
                }
                let size = meta.len();
                match entry.file_name().to_str() {
                    Some(THUMB_400_FILENAME) => {
                        thumbs_400_bytes += size;
                        file_count += 1;
                    }
                    Some(PREVIEW_FILENAME) => {
                        previews_bytes += size;
                        file_count += 1;
                    }
                    _ => {}
                }
            }
        }
    }

    let mut catalog_bytes = 0u64;
    for suffix in ["", "-wal", "-shm"] {
        let path = PathBuf::from(format!("{}{}", catalog_path.display(), suffix));
        if let Ok(meta) = std::fs::metadata(&path) {
            catalog_bytes += meta.len();
        }
    }

    let total_bytes = thumbs_400_bytes + previews_bytes + catalog_bytes;
    Ok(StorageUsage {
        thumbs_400_bytes,
        previews_bytes,
        catalog_bytes,
        total_bytes,
        file_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, rel: &str, bytes: &[u8]) {
        let path = dir.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, bytes).unwrap();
    }

    #[test]
    fn compute_storage_usage_sums_bytes_by_slot_filename() {
        let dir = tempfile::tempdir().unwrap();
        let thumbs_root = dir.path().join("thumbs");
        write(&thumbs_root, "hash1/400.webp", &[0u8; 100]);
        write(&thumbs_root, "hash1/2000.webp", &[0u8; 900]);
        write(&thumbs_root, "hash2/400.webp", &[0u8; 50]);
        // A stray non-slot file must never be counted.
        write(&thumbs_root, "hash2/other.txt", &[0u8; 999]);

        let catalog_path = dir.path().join("catalog.db");
        std::fs::write(&catalog_path, [0u8; 200]).unwrap();

        let usage = compute_storage_usage(&thumbs_root, &catalog_path).unwrap();
        assert_eq!(usage.thumbs_400_bytes, 150);
        assert_eq!(usage.previews_bytes, 900);
        assert_eq!(usage.catalog_bytes, 200);
        assert_eq!(usage.total_bytes, 1250);
        assert_eq!(usage.file_count, 3);
    }

    #[test]
    fn compute_storage_usage_includes_wal_and_shm_siblings() {
        let dir = tempfile::tempdir().unwrap();
        let thumbs_root = dir.path().join("thumbs");
        let catalog_path = dir.path().join("catalog.db");
        std::fs::write(&catalog_path, [0u8; 100]).unwrap();
        std::fs::write(dir.path().join("catalog.db-wal"), [0u8; 30]).unwrap();
        std::fs::write(dir.path().join("catalog.db-shm"), [0u8; 20]).unwrap();

        let usage = compute_storage_usage(&thumbs_root, &catalog_path).unwrap();
        assert_eq!(usage.catalog_bytes, 150);
    }

    #[test]
    fn compute_storage_usage_handles_a_thumbs_root_that_does_not_exist_yet() {
        let dir = tempfile::tempdir().unwrap();
        let thumbs_root = dir.path().join("never-created");
        let catalog_path = dir.path().join("catalog.db");

        let usage = compute_storage_usage(&thumbs_root, &catalog_path).unwrap();
        assert_eq!(usage.total_bytes, 0);
        assert_eq!(usage.file_count, 0);
    }

    #[test]
    fn reset_app_data_at_deletes_only_catalog_and_thumbs_under_a_temp_dir() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "catalog.db", b"db");
        write(dir.path(), "catalog.db-wal", b"wal");
        write(dir.path(), "catalog.db-shm", b"shm");
        write(dir.path(), "thumbs/hash1/400.webp", b"thumb");
        write(dir.path(), "thumbs/hash1/2000.webp", b"preview");
        // Sentinel files that must survive untouched — standing in for
        // anything else that might one day live in the app-data dir.
        write(dir.path(), "unrelated.txt", b"leave me alone");
        write(dir.path(), "logs/app.log", b"log line");

        reset_app_data_at(dir.path()).unwrap();

        assert!(!dir.path().join("catalog.db").exists());
        assert!(!dir.path().join("catalog.db-wal").exists());
        assert!(!dir.path().join("catalog.db-shm").exists());
        assert!(!dir.path().join("thumbs").exists());
        assert!(dir.path().join("unrelated.txt").exists());
        assert!(dir.path().join("logs/app.log").exists());
    }

    #[test]
    fn reset_app_data_at_is_a_no_op_on_an_already_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        assert!(reset_app_data_at(dir.path()).is_ok());
    }

    #[test]
    fn validate_preview_edge_accepts_every_documented_step() {
        for edge in ALLOWED_PREVIEW_EDGES {
            assert!(validate_preview_edge(edge).is_ok());
        }
    }

    #[test]
    fn validate_preview_edge_rejects_zero() {
        let err = validate_preview_edge(0).unwrap_err();
        assert!(matches!(err, DpError::Unsupported { .. }));
    }

    #[test]
    fn validate_preview_edge_rejects_an_off_step_value() {
        let err = validate_preview_edge(999).unwrap_err();
        assert!(matches!(err, DpError::Unsupported { .. }));
    }
}
