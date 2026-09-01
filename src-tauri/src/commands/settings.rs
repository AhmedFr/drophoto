use crate::state::AppState;
use dp_core::{
    AppSettings, DpError, DpResult, StorageUsage, ToolHealth, PREVIEW_EDGE_BALANCED, PREVIEW_EDGE_COMPACT,
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

/// Where `exiftool`/`ffmpeg` were found at startup, for Settings' tools
/// panel. A `None` here explains the field-reported all-metadata-empty
/// bug: the tool isn't reachable, so every read that needs it fails (see
/// `dp_core::ToolHealth`'s docs — snapshot from app launch, not live).
#[tauri::command]
pub async fn tool_health(state: State<'_, AppState>) -> Result<ToolHealth, DpError> {
    Ok(state.tool_health.clone())
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
/// computed against. Nothing cancels an in-flight scan/regen job first, so
/// a concurrent write can make a deletion fail (e.g. `ENOTEMPTY`); `?`
/// propagates that as an error instead of exiting, so the frontend gets to
/// show it (see `useSettingsData`'s `resetError`) rather than the app
/// silently continuing to run against a partially-deleted app-data dir.
/// `exit(0)` only ever runs once every deletion in [`reset_app_data_at`]
/// (in its documented `thumbs/`-then-`catalog.db*` order) has succeeded.
#[tauri::command]
pub async fn reset_app_data(state: State<'_, AppState>) -> Result<(), DpError> {
    reset_app_data_at(&state.app_data_dir)?;
    std::process::exit(0);
}

/// The actual deletion [`reset_app_data`] performs, factored out so it can
/// be unit-tested against a temp directory — never the real app-data path.
/// Deletes the whole `thumbs/` directory, then `catalog.db` plus its
/// `-wal`/`-shm` siblings (if present, WAL mode), all directly under `dir`.
/// Missing files/directories are silently skipped rather than erroring —
/// a partial or already-reset app-data dir is a normal, safe starting
/// point, not a failure.
///
/// `thumbs/` is deleted *before* `catalog.db*` deliberately: nothing
/// cancels an in-flight job first (see [`reset_app_data`]'s doc comment),
/// so a concurrent write can make `remove_dir_all(thumbs)` fail (e.g.
/// `ENOTEMPTY`). On failure this returns `Err` without touching anything
/// else, and [`reset_app_data`] propagates it (via `?`) instead of exiting
/// — so the worst case is "thumbs partially cleared, catalog.db untouched,
/// app keeps running and the dialog shows the error", not "catalog.db is
/// gone out from under a still-running app with no visible error".
fn reset_app_data_at(dir: &Path) -> DpResult<()> {
    let thumbs = dir.join("thumbs");
    if thumbs.exists() {
        std::fs::remove_dir_all(&thumbs).map_err(|e| DpError::io(&e, thumbs.display().to_string()))?;
    }

    for suffix in ["", "-wal", "-shm"] {
        let path = dir.join(format!("catalog.db{suffix}"));
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| DpError::io(&e, path.display().to_string()))?;
        }
    }

    Ok(())
}

/// Danger-zone action: moves the running `.app` bundle itself to the Trash
/// (never a permanent delete) and deletes the app's own data — same
/// deletion [`reset_app_data`] performs, via the same [`reset_app_data_at`]
/// helper — then exits. NEVER touches the user's photos, drives, or `.xmp`
/// sidecar files, and never touches anything outside the app's own data
/// dir and its own `.app` bundle.
///
/// Order (deliberately trash-then-delete, the strictly safer of the two —
/// review finding MAJOR-1): (1) [`plan_uninstall`] resolves the bundle path
/// from a *canonicalized* `current_exe()` — pure, no filesystem access,
/// fails fast before anything is touched if this isn't an installed `.app`
/// (e.g. `cargo tauri dev`); (2) [`trash_bundle`] the bundle — to Trash,
/// never a permanent delete; a failure here (read-only volume, DMG mount,
/// permissions) leaves the app's data completely untouched, since nothing
/// has been deleted yet; (3) delete app data; a failure *here* means the
/// bundle is already gone (safely, in the Trash — recoverable) but some
/// data survives, so the error message ([`partial_uninstall_message`])
/// says that explicitly rather than just surfacing a raw io error; (4)
/// `exit(0)`, reached only once both (2) and (3) succeed.
///
/// Trashing first also sidesteps a hazard the previous (delete-then-trash)
/// order had: deleting `catalog.db` out from under the still-running
/// process (open sqlx pool, unlinked-but-writable inode) purely to then
/// hit a *separate* fallible step. Moving the bundle is a same-volume
/// rename that doesn't touch the running process's open image at all.
#[tauri::command]
pub async fn uninstall_app(state: State<'_, AppState>) -> Result<(), DpError> {
    let exe_path = std::env::current_exe()
        .and_then(|p| p.canonicalize())
        .map_err(|e| DpError::io(&e, None))?;
    let bundle_path = plan_uninstall(&exe_path)?;

    trash_bundle(&bundle_path).map_err(|e| DpError::Io {
        message: append_volumes_hint(e.to_string(), &bundle_path),
        path: Some(bundle_path.display().to_string()),
    })?;

    if let Err(data_err) = reset_app_data_at(&state.app_data_dir) {
        return Err(DpError::Io {
            message: partial_uninstall_message(&state.app_data_dir, &data_err),
            path: Some(state.app_data_dir.display().to_string()),
        });
    }

    std::process::exit(0);
}

/// Moves `bundle_path` to the Trash using `NSFileManager` rather than
/// `trash`'s default `Finder`/AppleScript method (review finding
/// BLOCKER-1). The default method sends the delete as an Apple Event to
/// Finder, which requires the `com.apple.security.automation.apple-events`
/// entitlement plus an `NSAppleEventsUsageDescription` under a
/// hardened-runtime, notarized build (see `scripts/release.sh`) — this app
/// ships with neither, so the default method would fail with a TCC denial
/// rather than actually trashing anything. `NSFileManager` needs no extra
/// permissions at all (the only tradeoff, per `trash::macos::DeleteMethod`'s
/// own doc comment, is losing Finder's "Put Back" on some systems).
#[cfg(target_os = "macos")]
fn trash_bundle(bundle_path: &Path) -> Result<(), trash::Error> {
    use trash::macos::{DeleteMethod, TrashContextExtMacos};
    let mut ctx = trash::TrashContext::default();
    ctx.set_delete_method(DeleteMethod::NsFileManager);
    ctx.delete(bundle_path)
}

/// Non-macOS fallback (this app only ships for macOS, but keeps the
/// workspace buildable elsewhere) — `trash`'s default method, since the
/// Finder/Apple-Events hazard [`trash_bundle`]'s macOS doc comment
/// describes is macOS-specific.
#[cfg(not(target_os = "macos"))]
fn trash_bundle(bundle_path: &Path) -> Result<(), trash::Error> {
    trash::delete(bundle_path)
}

/// Appends a plain-language hint to a trash-failure `message` when
/// `bundle_path` sits under `/Volumes` — most likely still on the mounted
/// install DMG rather than dragged to Applications (review finding
/// MAJOR-2/3). A DMG's volume is read-only, so trashing anything on it can
/// never succeed; without this hint the user just sees a raw
/// "Operation not permitted"-style OS error with no idea what to do about
/// it. Pure (string check only, no filesystem access) so it's directly
/// unit-testable.
fn append_volumes_hint(message: String, bundle_path: &Path) -> String {
    if bundle_path.starts_with("/Volumes") {
        format!("{message} If you're running from the disk image, install drophoto to Applications first.")
    } else {
        message
    }
}

/// The error message [`uninstall_app`] returns when the bundle was
/// already successfully trashed but the subsequent [`reset_app_data_at`]
/// call then failed (review finding MAJOR-1) — states plainly that the app
/// itself is gone (moved to Trash, not deleted — recoverable) but its data
/// was not, and exactly where to find that data, so the user isn't left
/// guessing whether the uninstall did anything at all.
fn partial_uninstall_message(data_dir: &Path, data_err: &DpError) -> String {
    format!(
        "drophoto was moved to the Trash, but some app data could not be deleted ({data_err}). \
         You can remove it manually at {}.",
        data_dir.display()
    )
}

/// The pure, unit-testable part of [`uninstall_app`]: finds the nearest
/// (innermost) `.app` bundle ancestor containing `exe_path`, *and* verifies
/// `exe_path` actually sits at `<ancestor>/Contents/MacOS/<name>` — the
/// standard macOS bundle-executable location (review finding MINOR-2). No
/// filesystem access, so no real bundle needs to exist on disk to test
/// this. In a normal signed install this is e.g. `/Applications/drophoto.app`
/// for an exe at `/Applications/drophoto.app/Contents/MacOS/drophoto`. A
/// dev run's exe (e.g. `target/debug/drophoto`) has no `.app` path
/// component at all, so there's nothing to trash — this refuses with
/// [`DpError::Unsupported`] rather than trashing something arbitrary;
/// [`uninstall_app`] surfaces that to the UI plainly instead of silently
/// doing nothing. Requiring the exact `Contents/MacOS` shape (rather than
/// accepting any nearest `.app` ancestor) makes "we only ever trash our
/// own bundle" structurally true, not just incidentally true.
fn plan_uninstall(exe_path: &Path) -> DpResult<PathBuf> {
    exe_path
        .ancestors()
        .find(|ancestor| is_running_app_bundle(exe_path, ancestor))
        .map(PathBuf::from)
        .ok_or_else(|| DpError::Unsupported {
            message: "not running from an installed .app bundle".to_string(),
            path: Some(exe_path.display().to_string()),
        })
}

/// Whether `ancestor` is a `.app` bundle directory that `exe_path` sits
/// inside at exactly `<ancestor>/Contents/MacOS/<name>`.
fn is_running_app_bundle(exe_path: &Path, ancestor: &Path) -> bool {
    if ancestor.extension().is_none_or(|ext| ext != "app") {
        return false;
    }
    let Ok(relative) = exe_path.strip_prefix(ancestor) else {
        return false;
    };
    let mut components = relative.components();
    let is_contents = components.next().is_some_and(|c| c.as_os_str() == "Contents");
    let is_macos = components.next().is_some_and(|c| c.as_os_str() == "MacOS");
    let has_exe_name = components.next().is_some();
    let nothing_after = components.next().is_none();
    is_contents && is_macos && has_exe_name && nothing_after
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

    // Review finding 4: `thumbs/` must be deleted before `catalog.db*`, and
    // a failed deletion must be returned as an `Err` (not silently
    // swallowed by an `exit(0)` that never runs) rather than leaving
    // `catalog.db` gone out from under a still-running app.
    #[test]
    #[cfg(unix)]
    fn reset_app_data_at_deletes_thumbs_before_catalog_db_and_returns_err_on_failure() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "catalog.db", b"db");
        write(dir.path(), "thumbs/hash1/400.webp", b"thumb");

        let thumbs = dir.path().join("thumbs");
        // Strip write permission from `thumbs` itself so an entry inside
        // it can't be unlinked — `remove_dir_all` fails partway through.
        std::fs::set_permissions(&thumbs, std::fs::Permissions::from_mode(0o555)).unwrap();

        let result = reset_app_data_at(dir.path());

        // Restore permissions so the tempdir can clean itself up.
        std::fs::set_permissions(&thumbs, std::fs::Permissions::from_mode(0o755)).unwrap();

        assert!(matches!(result, Err(DpError::Io { .. })));
        // catalog.db must still be present: thumbs/ is attempted first, so
        // a failure there must return before catalog.db is ever touched.
        assert!(dir.path().join("catalog.db").exists());
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

    #[test]
    fn plan_uninstall_finds_the_app_bundle_ancestor_of_the_running_executable() {
        let exe = Path::new("/Applications/drophoto.app/Contents/MacOS/drophoto");
        let bundle = plan_uninstall(exe).unwrap();
        assert_eq!(bundle, PathBuf::from("/Applications/drophoto.app"));
    }

    #[test]
    fn plan_uninstall_refuses_a_dev_run_with_no_app_bundle_ancestor() {
        let exe = Path::new("target/debug/drophoto");
        let err = plan_uninstall(exe).unwrap_err();
        assert!(matches!(err, DpError::Unsupported { .. }));
    }

    #[test]
    fn plan_uninstall_returns_the_innermost_app_ancestor_when_nested() {
        let exe = Path::new("/Applications/Outer.app/Contents/Resources/Inner.app/Contents/MacOS/drophoto");
        let bundle = plan_uninstall(exe).unwrap();
        assert_eq!(
            bundle,
            PathBuf::from("/Applications/Outer.app/Contents/Resources/Inner.app")
        );
    }

    // Review finding 5: a `.app` ancestor only counts if the exe actually
    // sits at `<bundle>/Contents/MacOS/<name>` — an ancestor `.app` whose
    // exe is buried somewhere else inside it must be refused, not trashed.
    #[test]
    fn plan_uninstall_refuses_an_app_ancestor_whose_exe_is_not_under_contents_macos() {
        let exe = Path::new("/Applications/Other.app/some/weird/place/drophoto");
        let err = plan_uninstall(exe).unwrap_err();
        assert!(matches!(err, DpError::Unsupported { .. }));
    }

    // Review finding 3: when the bundle is on the mounted install DMG
    // (`/Volumes/...`), append a plain hint rather than just the raw
    // trash-backend error.
    #[test]
    fn append_volumes_hint_adds_a_hint_for_a_dmg_mounted_bundle() {
        let msg = append_volumes_hint("boom".to_string(), Path::new("/Volumes/drophoto/drophoto.app"));
        assert!(msg.contains("disk image"), "message was: {msg}");
    }

    #[test]
    fn append_volumes_hint_leaves_an_applications_bundle_message_untouched() {
        let msg = append_volumes_hint("boom".to_string(), Path::new("/Applications/drophoto.app"));
        assert_eq!(msg, "boom");
    }

    // Review finding 2: once the bundle is trashed, a subsequent data-
    // deletion failure must say plainly that the app itself is already
    // gone (in the Trash, not deleted) and where to find the leftover
    // data — not just surface the raw io error.
    #[test]
    fn partial_uninstall_message_states_the_app_is_gone_but_data_remains() {
        let data_err = DpError::Io {
            message: "permission denied".to_string(),
            path: None,
        };
        let data_dir = Path::new("/Users/x/Library/Application Support/drophoto");
        let msg = partial_uninstall_message(data_dir, &data_err);

        assert!(msg.contains("moved to the Trash"), "message was: {msg}");
        assert!(msg.contains("could not be deleted"), "message was: {msg}");
        assert!(msg.contains("permission denied"), "message was: {msg}");
        assert!(
            msg.contains("/Users/x/Library/Application Support/drophoto"),
            "message was: {msg}"
        );
    }
}
