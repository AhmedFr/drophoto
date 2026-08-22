use crate::state::AppState;
use dp_core::{DpError, Drive, NewDrive};
use tauri::State;

#[tauri::command]
pub async fn register_drive(state: State<'_, AppState>, input: NewDrive) -> Result<Drive, DpError> {
    state.catalog.register_drive(input).await
}

#[tauri::command]
pub async fn list_drives(state: State<'_, AppState>) -> Result<Vec<Drive>, DpError> {
    state.catalog.list_drives().await
}
