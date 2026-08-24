use crate::commands::media_item::to_item;
use crate::state::AppState;
use dp_core::{DpError, MediaItem};
use tauri::State;

/// Max results a single search returns, regardless of what the caller
/// asks for — keeps a broad/short query from pulling an unbounded result
/// set (and its thumbnails) into memory.
const SEARCH_LIMIT_CAP: u32 = 500;

#[tauri::command]
pub async fn search_media(
    state: State<'_, AppState>,
    query: String,
    limit: u32,
) -> Result<Vec<MediaItem>, DpError> {
    let limit = clamped_limit(limit);
    Ok(state
        .catalog
        .search_media(&query, limit)
        .await?
        .into_iter()
        .map(|(r, d)| to_item(&state.store, r, d))
        .collect())
}

/// Caps `limit` at [`SEARCH_LIMIT_CAP`], leaving anything at or under the
/// cap (including 0) untouched.
///
/// Pure (no catalog, no `AppState`) so it can be unit-tested directly.
pub(crate) fn clamped_limit(limit: u32) -> u32 {
    limit.min(SEARCH_LIMIT_CAP)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_a_limit_under_the_cap_untouched() {
        assert_eq!(clamped_limit(50), 50);
    }

    #[test]
    fn leaves_a_limit_exactly_at_the_cap_untouched() {
        assert_eq!(clamped_limit(SEARCH_LIMIT_CAP), SEARCH_LIMIT_CAP);
    }

    #[test]
    fn clamps_a_limit_over_the_cap_down_to_the_cap() {
        assert_eq!(clamped_limit(SEARCH_LIMIT_CAP + 1), SEARCH_LIMIT_CAP);
        assert_eq!(clamped_limit(10_000), SEARCH_LIMIT_CAP);
    }

    #[test]
    fn leaves_zero_untouched() {
        assert_eq!(clamped_limit(0), 0);
    }
}
