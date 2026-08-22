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
