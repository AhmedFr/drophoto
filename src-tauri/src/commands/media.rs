use crate::commands::media_item::to_item;
use crate::state::AppState;
use dp_catalog::Catalog;
use dp_core::{DpError, DpResult, MediaItem, MediaQuery};
use std::sync::Arc;
use tauri::State;

/// How many undated rows [`recover_filename_dates`] fetches and writes per
/// transaction — kept small enough that a large library never builds one
/// enormous transaction, but large enough that a real run (thousands of
/// rows) doesn't take an excessive number of round trips. Overridden with
/// a much smaller value in this module's own tests, so multi-batch cursor
/// behaviour can be exercised without inserting thousands of rows.
const RECOVER_FILENAME_DATES_BATCH: u32 = 2000;

#[tauri::command]
pub async fn query_media(state: State<'_, AppState>, query: MediaQuery) -> Result<Vec<MediaItem>, DpError> {
    Ok(state
        .catalog
        .query_media(&query)
        .await?
        .into_iter()
        .map(|(r, d)| to_item(&state.store, r, d))
        .collect())
}

#[tauri::command]
pub async fn count_media(state: State<'_, AppState>, query: MediaQuery) -> Result<u64, DpError> {
    state.catalog.count_media_query(&query).await
}

#[tauri::command]
pub async fn get_media(state: State<'_, AppState>, id: i64) -> Result<MediaItem, DpError> {
    let (r, d) = state.catalog.get_media_with_drive(id).await?;
    Ok(to_item(&state.store, r, d))
}

/// How many rows currently have no `taken_at` — the number the Settings
/// action offers to recover.
#[tauri::command]
pub async fn count_undated(state: State<'_, AppState>) -> Result<u64, DpError> {
    state.catalog.count_undated().await
}

/// Fills `taken_at` from the filename for every row that has no date, in
/// batches so a large library doesn't build one enormous transaction.
/// Returns how many rows were actually given a date. See
/// [`recover_filename_dates_at`] for the actual loop (factored out so it
/// can be unit-tested against a small batch size and an in-memory
/// catalog, the same pattern as `check_sidecar_files_at`).
#[tauri::command]
pub async fn recover_filename_dates(state: State<'_, AppState>) -> Result<u64, DpError> {
    recover_filename_dates_at(&state.catalog, RECOVER_FILENAME_DATES_BATCH).await
}

/// Cursor-paginated by `id` (via `list_undated`'s `after_id`), advanced
/// past the last row *examined* in a batch regardless of whether it
/// parsed — not offset-paginated, and not "stop at the first batch that
/// parses nothing": a page whose rel_paths all happen to be unparseable
/// (an early import that never used a date-shaped filename, say) must not
/// stop the whole run early and strand every parseable row sitting at a
/// higher id. `list_undated` never returns a row twice: once a row is
/// examined its id becomes the new cursor floor, whether or not it ended
/// up getting a date.
async fn recover_filename_dates_at(catalog: &Arc<dyn Catalog>, batch_size: u32) -> DpResult<u64> {
    let mut total = 0u64;
    let mut after_id = 0i64;
    loop {
        let batch = catalog.list_undated(after_id, batch_size).await?;
        let Some(&(last_id, _)) = batch.last() else {
            break;
        };
        after_id = last_id;
        let parsed: Vec<_> = batch
            .iter()
            .filter_map(|(id, path)| dp_metadata::date_from_filename(path).map(|d| (*id, d)))
            .collect();
        if !parsed.is_empty() {
            total += catalog.set_taken_at_bulk(&parsed).await?;
        }
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use dp_catalog::SqliteCatalog;
    use dp_core::{DriveRole, MediaKind, NewDrive, NewMedia};

    fn nm(drive_id: i64, rel_path: &str) -> NewMedia {
        NewMedia {
            drive_id,
            rel_path: rel_path.into(),
            hash: format!("hash-{rel_path}"),
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

    async fn catalog_with_drive() -> (Arc<dyn Catalog>, i64) {
        let catalog: Arc<dyn Catalog> = Arc::new(SqliteCatalog::open_in_memory().await.unwrap());
        let drive = catalog
            .register_drive(NewDrive {
                name: "A".into(),
                mount_path: "/Volumes/A".into(),
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

    /// The regression this whole function exists for: with a batch size of
    /// 2, the lowest-id page (`a.jpg`, `b.jpg`) parses nothing at all —
    /// every row in it gets examined and skipped, not retried — yet the
    /// run must still advance to the next page and recover the
    /// WhatsApp-named row sitting behind it.
    #[tokio::test]
    async fn a_batch_that_parses_nothing_does_not_stop_a_later_batch_from_being_examined() {
        let (catalog, drive_id) = catalog_with_drive().await;
        catalog.upsert_media(nm(drive_id, "a.jpg")).await.unwrap();
        catalog.upsert_media(nm(drive_id, "b.jpg")).await.unwrap();
        let recoverable = catalog
            .upsert_media(nm(drive_id, "IMG-20240816-WA0010.jpg"))
            .await
            .unwrap();

        let recovered = recover_filename_dates_at(&catalog, 2).await.unwrap();

        assert_eq!(recovered, 1);
        assert_eq!(catalog.count_undated().await.unwrap(), 2);
        let (row, _) = catalog.get_media_with_drive(recoverable).await.unwrap();
        assert_eq!(
            row.taken_at,
            Some(chrono::Utc.with_ymd_and_hms(2024, 8, 16, 0, 0, 0).unwrap())
        );
    }

    /// Every page gets examined exactly once even when none of them parse
    /// — proving the cursor genuinely terminates rather than looping
    /// forever or re-fetching the same stuck page.
    #[tokio::test]
    async fn terminates_when_nothing_at_all_is_recoverable() {
        let (catalog, drive_id) = catalog_with_drive().await;
        for name in ["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg"] {
            catalog.upsert_media(nm(drive_id, name)).await.unwrap();
        }

        let recovered = recover_filename_dates_at(&catalog, 2).await.unwrap();

        assert_eq!(recovered, 0);
        assert_eq!(catalog.count_undated().await.unwrap(), 5);
    }

    /// A batch straddling several pages, mixing parseable and unparseable
    /// rows throughout, must recover every parseable one regardless of
    /// which page it landed on.
    #[tokio::test]
    async fn recovers_every_parseable_row_across_many_pages() {
        let (catalog, drive_id) = catalog_with_drive().await;
        let unrecoverable_a = catalog.upsert_media(nm(drive_id, "a.jpg")).await.unwrap();
        let recoverable_1 = catalog
            .upsert_media(nm(drive_id, "IMG-20240816-WA0010.jpg"))
            .await
            .unwrap();
        let unrecoverable_b = catalog.upsert_media(nm(drive_id, "b.jpg")).await.unwrap();
        let unrecoverable_c = catalog.upsert_media(nm(drive_id, "c.jpg")).await.unwrap();
        let recoverable_2 = catalog
            .upsert_media(nm(drive_id, "VID-20211203-WA0001.mp4"))
            .await
            .unwrap();

        let recovered = recover_filename_dates_at(&catalog, 2).await.unwrap();

        assert_eq!(recovered, 2);
        for id in [unrecoverable_a, unrecoverable_b, unrecoverable_c] {
            assert_eq!(catalog.get_media_with_drive(id).await.unwrap().0.taken_at, None);
        }
        assert_eq!(
            catalog
                .get_media_with_drive(recoverable_1)
                .await
                .unwrap()
                .0
                .taken_at,
            Some(chrono::Utc.with_ymd_and_hms(2024, 8, 16, 0, 0, 0).unwrap())
        );
        assert_eq!(
            catalog
                .get_media_with_drive(recoverable_2)
                .await
                .unwrap()
                .0
                .taken_at,
            Some(chrono::Utc.with_ymd_and_hms(2021, 12, 3, 0, 0, 0).unwrap())
        );
    }
}
