use crate::state::AppState;
use dp_core::DpError;
use tauri::State;

/// Drops and refills the whole `media_fts` index from current catalog
/// state — the manual recovery path for when the index is suspected to
/// have drifted. `SqliteCatalog::open` already does this automatically
/// on startup if it finds `media_fts` empty while `media` has rows (see
/// `dp_catalog::sqlite`), so this command exists for the rarer case of a
/// drift that happens mid-session.
#[tauri::command]
pub async fn rebuild_fts(state: State<'_, AppState>) -> Result<(), DpError> {
    state.catalog.rebuild_fts().await
}
