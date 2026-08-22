use crate::state::AppState;
use dp_core::{DpError, Drive, MediaItem, MediaQuery, MediaRow};
use tauri::State;

fn to_item(state: &AppState, row: MediaRow, drive: Drive) -> MediaItem {
    MediaItem {
        thumb_path: state.store.path(&row.hash, 400).to_string_lossy().into_owned(),
        preview_path: state.store.path(&row.hash, 2000).to_string_lossy().into_owned(),
        drive_name: drive.name,
        online: drive.online,
        row,
    }
}

#[tauri::command]
pub async fn query_media(state: State<'_, AppState>, query: MediaQuery) -> Result<Vec<MediaItem>, DpError> {
    Ok(state
        .catalog
        .query_media(&query)
        .await?
        .into_iter()
        .map(|(r, d)| to_item(&state, r, d))
        .collect())
}

#[tauri::command]
pub async fn count_media(state: State<'_, AppState>, query: MediaQuery) -> Result<u64, DpError> {
    state.catalog.count_media_query(&query).await
}

#[tauri::command]
pub async fn get_media(state: State<'_, AppState>, id: i64) -> Result<MediaItem, DpError> {
    let (r, d) = state.catalog.get_media_with_drive(id).await?;
    Ok(to_item(&state, r, d))
}
