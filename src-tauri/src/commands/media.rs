use crate::state::AppState;
use dp_core::{DpError, MediaItem};
use tauri::State;

#[tauri::command]
pub async fn list_media(
    state: State<'_, AppState>,
    limit: u32,
    offset: u32,
) -> Result<Vec<MediaItem>, DpError> {
    let pairs = state.catalog.list_media_with_drive(limit, offset).await?;
    Ok(pairs
        .into_iter()
        .map(|(row, drive)| {
            let thumb_path = state.store.path(&row.hash, 400).to_string_lossy().to_string();
            MediaItem {
                row,
                thumb_path,
                drive_name: drive.name,
                online: drive.online,
            }
        })
        .collect())
}
