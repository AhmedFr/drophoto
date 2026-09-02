use crate::state::AppState;
use dp_catalog::Catalog;
use dp_core::{DpError, DpResult, SidecarHealth};
use dp_jobs::{Job, SidecarSyncDeps, SidecarSyncJob};
use dp_metadata::sidecar_path;
use std::path::Path;
use std::sync::Arc;
use tauri::State;

/// Starts a [`SidecarSyncJob`] for every online drive that has at least
/// one sidecar-pending row, and returns the ids of every job actually
/// started.
///
/// Called by the frontend as a background sweep (after a scan finishes,
/// and whenever the set of known drives changes), not directly by the
/// user, so admission refusal — another job already running on a given
/// drive — is skipped silently rather than surfaced as an error: the next
/// trigger simply retries that drive.
#[tauri::command]
pub async fn start_sidecar_sync_all(state: State<'_, AppState>) -> Result<Vec<String>, DpError> {
    let drives = state.catalog.list_drives().await?;
    let mut started = Vec::new();

    for drive in drives {
        if drive.mount_path.is_none() {
            continue;
        }

        if !state.catalog.has_sidecar_pending(drive.id).await? {
            continue;
        }

        let deps = SidecarSyncDeps {
            catalog: state.catalog.clone(),
            sidecars: state.sidecars.clone(),
            home: state.home.clone(),
        };

        let drive_id = drive.id;
        if let Ok(job_id) = state.start_sidecar_sync(drive_id, move |job_id| {
            Arc::new(SidecarSyncJob::new(job_id, drive, deps)) as Arc<dyn Job>
        }) {
            started.push(job_id);
        }
    }

    Ok(started)
}

/// `drive_id`'s sidecar coverage for Settings' SIDECARS panel — how many
/// media rows carry a tag, and how many are currently queued for the next
/// `SidecarSyncJob` sweep. See [`dp_core::SidecarHealth`].
#[tauri::command]
pub async fn sidecar_health(state: State<'_, AppState>, drive_id: i64) -> Result<SidecarHealth, DpError> {
    state.catalog.sidecar_health(drive_id).await
}

/// Stats a `.xmp` sidecar for every tagged row on `drive_id` and flags
/// every row whose sidecar is missing as `sidecar_pending` — the "CHECK
/// FILES" button in Settings' SIDECARS panel, populating the repair queue
/// the existing `SidecarSyncJob` sweep (`start_sidecar_sync_all`) later
/// drains. Read-only on disk: this only ever `stat`s a path, never writes
/// to the user's photos or `.xmp` sidecars — the flag it sets is a
/// catalog column, and the actual rewrite happens later, only when a
/// sidecar sync job runs. Returns how many missing sidecars were found
/// (and newly queued) this sweep.
///
/// Refuses with [`DpError::NotFound`] ("drive is offline") for an
/// offline drive, same shape as [`crate::commands::scan::start_scan`] —
/// there's no mount to stat against.
#[tauri::command]
pub async fn check_sidecar_files(state: State<'_, AppState>, drive_id: i64) -> Result<u64, DpError> {
    let drive = state
        .catalog
        .list_drives()
        .await?
        .into_iter()
        .find(|d| d.id == drive_id)
        .ok_or_else(|| DpError::NotFound {
            message: format!("drive {drive_id} not found"),
        })?;

    let mount_path = drive.mount_path.ok_or_else(|| DpError::NotFound {
        message: "drive is offline".into(),
    })?;
    let mount = std::fs::canonicalize(&mount_path).map_err(|e| DpError::Io {
        message: format!("failed to canonicalize mount path: {e}"),
        path: Some(mount_path.clone()),
    })?;

    check_sidecar_files_at(&state.catalog, drive_id, &mount).await
}

/// The actual sweep [`check_sidecar_files`] performs, factored out so it
/// can be unit-tested against a temp directory and an in-memory catalog
/// rather than a real `AppState`. For every row
/// [`Catalog::list_tagged_media`] returns, stats
/// `sidecar_path(mount.join(rel_path))` (run via `tokio::fs`, off the
/// main thread); a row whose sidecar is missing is flagged via
/// [`Catalog::mark_sidecar_pending`] and counted. A row whose sidecar
/// *is* present is left completely untouched — this never clears
/// `sidecar_pending`, only ever sets it, so a row already pending from an
/// unrelated tag edit simply stays pending.
async fn check_sidecar_files_at(catalog: &Arc<dyn Catalog>, drive_id: i64, mount: &Path) -> DpResult<u64> {
    let tagged = catalog.list_tagged_media(drive_id).await?;

    let mut missing = 0u64;
    for row in &tagged {
        let sidecar = sidecar_path(&mount.join(&row.rel_path));
        if tokio::fs::metadata(&sidecar).await.is_err() {
            catalog.mark_sidecar_pending(row.id).await?;
            missing += 1;
        }
    }

    Ok(missing)
}

#[cfg(test)]
mod tests {
    use super::*;
    use dp_catalog::SqliteCatalog;
    use dp_core::{DriveRole, MediaKind, NewDrive, NewMedia};

    fn nm(drive_id: i64, rel_path: &str, hash: &str) -> NewMedia {
        NewMedia {
            drive_id,
            rel_path: rel_path.into(),
            hash: hash.into(),
            size: 10,
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
            mtime: None,
            source_id: None,
        }
    }

    async fn catalog_with_drive(mount: &Path) -> (Arc<dyn Catalog>, i64) {
        let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
        let drive = catalog
            .register_drive(NewDrive {
                name: "A".into(),
                mount_path: mount.display().to_string(),
                role: DriveRole::Archive,
                capacity: 100,
                free: 40,
                volume_uuid: None,
                volume_label: None,
            })
            .await
            .unwrap();
        (catalog, drive.id)
    }

    #[tokio::test]
    async fn queues_only_rows_whose_sidecar_is_actually_missing() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.jpg"), b"a").unwrap();
        std::fs::write(dir.path().join("a.jpg.xmp"), b"<xmp/>").unwrap();
        std::fs::write(dir.path().join("b.jpg"), b"b").unwrap();
        // No sidecar written for b.jpg.

        let (catalog, drive_id) = catalog_with_drive(dir.path()).await;
        let a = catalog.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
        let b = catalog.upsert_media(nm(drive_id, "b.jpg", "h-b")).await.unwrap();
        catalog.tag_media(&[a, b], &["Trip".into()], &[]).await.unwrap();
        // Both rows start pending from `tag_media` itself — clear that so
        // the assertions below are only about what the sweep does.
        catalog.clear_sidecar_pending(a).await.unwrap();
        catalog.clear_sidecar_pending(b).await.unwrap();

        let missing = check_sidecar_files_at(&catalog, drive_id, dir.path())
            .await
            .unwrap();
        assert_eq!(missing, 1);

        let pending = catalog.list_sidecar_pending(drive_id).await.unwrap();
        let pending_ids: Vec<i64> = pending.iter().map(|r| r.id).collect();
        assert_eq!(pending_ids, vec![b]);
    }

    #[tokio::test]
    async fn reports_zero_and_queues_nothing_when_every_sidecar_is_present() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.jpg"), b"a").unwrap();
        std::fs::write(dir.path().join("a.jpg.xmp"), b"<xmp/>").unwrap();

        let (catalog, drive_id) = catalog_with_drive(dir.path()).await;
        let a = catalog.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
        catalog.tag_media(&[a], &["Trip".into()], &[]).await.unwrap();
        catalog.clear_sidecar_pending(a).await.unwrap();

        let missing = check_sidecar_files_at(&catalog, drive_id, dir.path())
            .await
            .unwrap();
        assert_eq!(missing, 0);
        assert!(catalog.list_sidecar_pending(drive_id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn ignores_untagged_rows_even_with_no_sidecar_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.jpg"), b"a").unwrap();
        // No sidecar, and a.jpg is never tagged.

        let (catalog, drive_id) = catalog_with_drive(dir.path()).await;
        catalog.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();

        let missing = check_sidecar_files_at(&catalog, drive_id, dir.path())
            .await
            .unwrap();
        assert_eq!(missing, 0);
        assert!(catalog.list_sidecar_pending(drive_id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn leaves_an_already_pending_row_pending_when_its_sidecar_is_present() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.jpg"), b"a").unwrap();
        std::fs::write(dir.path().join("a.jpg.xmp"), b"<xmp/>").unwrap();

        let (catalog, drive_id) = catalog_with_drive(dir.path()).await;
        let a = catalog.upsert_media(nm(drive_id, "a.jpg", "h-a")).await.unwrap();
        // `tag_media` leaves `a` pending (sidecar not yet synced) even
        // though the file on disk already exists.
        catalog.tag_media(&[a], &["Trip".into()], &[]).await.unwrap();

        let missing = check_sidecar_files_at(&catalog, drive_id, dir.path())
            .await
            .unwrap();
        assert_eq!(missing, 0);

        let pending = catalog.list_sidecar_pending(drive_id).await.unwrap();
        assert_eq!(pending.iter().map(|r| r.id).collect::<Vec<_>>(), vec![a]);
    }
}
