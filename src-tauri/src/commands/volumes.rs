use crate::state::AppState;
use dp_core::{DpError, Volume};
use tauri::State;

#[tauri::command]
pub async fn list_volumes(state: State<'_, AppState>) -> Result<Vec<Volume>, DpError> {
    state.volumes.list().await
}
