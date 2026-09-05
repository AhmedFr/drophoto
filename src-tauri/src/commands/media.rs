use crate::commands::media_item::to_item;
use crate::state::AppState;
use dp_core::{DpError, MediaItem, MediaQuery};
use tauri::State;

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
/// Returns how many rows were actually given a date.
///
/// `list_undated` returns the *same* rows every call, because unparseable
/// rows stay NULL forever. Stopping once a batch parses nothing is what
/// makes this terminate — an offset would be wrong here, since a row that
/// just got a date leaves the result set and would shift the window.
#[tauri::command]
pub async fn recover_filename_dates(state: State<'_, AppState>) -> Result<u64, DpError> {
    const BATCH: u32 = 2000;
    let mut total = 0u64;
    loop {
        let batch = state.catalog.list_undated(BATCH).await?;
        if batch.is_empty() {
            break;
        }
        let parsed: Vec<_> = batch
            .iter()
            .filter_map(|(id, path)| dp_metadata::date_from_filename(path).map(|d| (*id, d)))
            .collect();
        if parsed.is_empty() {
            break;
        }
        total += state.catalog.set_taken_at_bulk(&parsed).await?;
    }
    Ok(total)
}
