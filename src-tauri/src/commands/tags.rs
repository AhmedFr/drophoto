use crate::state::AppState;
use dp_core::{DpError, DpResult, Tag, TagWithCount};
use tauri::State;

/// Longest a tag name is allowed to be, after trimming. Chosen to keep
/// tags readable in chips/lists rather than for any storage limit.
const MAX_TAG_NAME_LEN: usize = 64;

#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, DpError> {
    state.catalog.list_tags().await
}

/// Every tag with its linked-media count, for the Tags page.
#[tauri::command]
pub async fn list_tags_with_counts(state: State<'_, AppState>) -> Result<Vec<TagWithCount>, DpError> {
    state.catalog.list_tags_with_counts().await
}

#[tauri::command]
pub async fn tags_for_media(
    state: State<'_, AppState>,
    media_ids: Vec<i64>,
) -> Result<Vec<(i64, Tag)>, DpError> {
    state.catalog.tags_for_media(&media_ids).await
}

/// Applies `add`/`remove` to every id in `media_ids` — see
/// [`dp_catalog::Catalog::tag_media`] for the underlying transaction
/// (tag creation, linking/unlinking, and the `sidecar_pending`
/// bookkeeping it does per touched row).
///
/// `add` entries are validated server-side by [`normalize_tag_names`]
/// before anything is written: trimmed, with empties silently dropped
/// (not an error — e.g. a UI text field cleared to blank) and any
/// surviving entry over [`MAX_TAG_NAME_LEN`] characters refusing the
/// whole call. `media_ids` empty is a no-op, `Ok(())`.
///
/// This command does **not** itself trigger a sidecar sync — the UI
/// calls `start_sidecar_sync_all` after a successful mutation (a later
/// task), reusing the existing sweep rather than this command
/// fire-and-forgetting one of its own.
#[tauri::command]
pub async fn tag_media(
    state: State<'_, AppState>,
    media_ids: Vec<i64>,
    add: Vec<String>,
    remove: Vec<i64>,
) -> Result<(), DpError> {
    if media_ids.is_empty() {
        return Ok(());
    }

    let add = normalize_tag_names(add)?;
    state.catalog.tag_media(&media_ids, &add, &remove).await
}

/// Renames tag `id` to `new_name` — see
/// [`dp_catalog::Catalog::rename_tag`] for the collision-becomes-a-merge
/// semantics.
#[tauri::command]
pub async fn rename_tag(state: State<'_, AppState>, id: i64, new_name: String) -> Result<(), DpError> {
    let name = normalize_required_tag_name(new_name)?;
    state.catalog.rename_tag(id, &name).await
}

/// Trims `name` and refuses (with [`DpError::Unsupported`]) if the result
/// is empty or over [`MAX_TAG_NAME_LEN`] — the same rules as
/// [`normalize_tag_names`] (reused via it, not duplicated), except a
/// single required name can't silently drop an empty result the way an
/// `add` list can (there's no other name left to fall back to): a
/// `name` that normalizes to nothing is refused instead of dropped.
///
/// Pure, so it can be unit-tested directly.
pub(crate) fn normalize_required_tag_name(name: String) -> DpResult<String> {
    let mut normalized = normalize_tag_names(vec![name])?;
    normalized.pop().ok_or_else(|| DpError::Unsupported {
        message: "tag name must not be empty".to_string(),
        path: None,
    })
}

/// Merges every tag in `from_ids` into `into_id` — see
/// [`dp_catalog::Catalog::merge_tags`].
#[tauri::command]
pub async fn merge_tags(state: State<'_, AppState>, from_ids: Vec<i64>, into_id: i64) -> Result<(), DpError> {
    state.catalog.merge_tags(&from_ids, into_id).await
}

/// Deletes tag `id` and its links — see [`dp_catalog::Catalog::delete_tag`].
/// Never touches any photo file; only queues the affected rows' sidecars
/// for a rewrite (via `sidecar_pending`, the same as every other tag
/// mutation here).
#[tauri::command]
pub async fn delete_tag(state: State<'_, AppState>, id: i64) -> Result<(), DpError> {
    state.catalog.delete_tag(id).await
}

/// Trims every entry in `add` and drops empties (not an error). Refuses
/// the whole call with [`DpError::Unsupported`] if any surviving entry
/// is longer than [`MAX_TAG_NAME_LEN`] characters.
///
/// Pure (no catalog, no `AppState`) so it can be unit-tested directly.
pub(crate) fn normalize_tag_names(add: Vec<String>) -> DpResult<Vec<String>> {
    let mut out = Vec::with_capacity(add.len());
    for name in add {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.chars().count() > MAX_TAG_NAME_LEN {
            return Err(DpError::Unsupported {
                message: format!("tag name too long (max {MAX_TAG_NAME_LEN} characters)"),
                path: None,
            });
        }
        out.push(trimmed.to_string());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_whitespace_around_names() {
        let out = normalize_tag_names(vec!["  Family  ".to_string(), "Trip".to_string()]).unwrap();
        assert_eq!(out, vec!["Family".to_string(), "Trip".to_string()]);
    }

    #[test]
    fn drops_empty_and_whitespace_only_entries_without_erroring() {
        let out = normalize_tag_names(vec!["".to_string(), "   ".to_string(), "Family".to_string()]).unwrap();
        assert_eq!(out, vec!["Family".to_string()]);
    }

    #[test]
    fn accepts_a_name_exactly_at_the_length_limit() {
        let name = "a".repeat(MAX_TAG_NAME_LEN);
        let out = normalize_tag_names(vec![name.clone()]).unwrap();
        assert_eq!(out, vec![name]);
    }

    #[test]
    fn refuses_a_name_over_the_length_limit() {
        let name = "a".repeat(MAX_TAG_NAME_LEN + 1);
        let err = normalize_tag_names(vec![name]).unwrap_err();
        match err {
            DpError::Unsupported { message, path } => {
                assert_eq!(message, "tag name too long (max 64 characters)");
                assert_eq!(path, None);
            }
            other => panic!("expected Unsupported, got {other:?}"),
        }
    }

    #[test]
    fn checks_length_after_trimming_surrounding_whitespace() {
        // Padding alone shouldn't push a name over the limit — only the
        // trimmed content counts.
        let name = format!("  {}  ", "a".repeat(MAX_TAG_NAME_LEN));
        let out = normalize_tag_names(vec![name]).unwrap();
        assert_eq!(out, vec!["a".repeat(MAX_TAG_NAME_LEN)]);
    }

    #[test]
    fn required_name_trims_whitespace() {
        let out = normalize_required_tag_name("  Vacation  ".to_string()).unwrap();
        assert_eq!(out, "Vacation");
    }

    #[test]
    fn required_name_refuses_empty_input() {
        let err = normalize_required_tag_name("".to_string()).unwrap_err();
        match err {
            DpError::Unsupported { message, path } => {
                assert_eq!(message, "tag name must not be empty");
                assert_eq!(path, None);
            }
            other => panic!("expected Unsupported, got {other:?}"),
        }
    }

    #[test]
    fn required_name_refuses_whitespace_only_input() {
        let err = normalize_required_tag_name("   ".to_string()).unwrap_err();
        assert!(matches!(err, DpError::Unsupported { .. }));
    }

    #[test]
    fn required_name_refuses_over_length_input() {
        let name = "a".repeat(MAX_TAG_NAME_LEN + 1);
        let err = normalize_required_tag_name(name).unwrap_err();
        match err {
            DpError::Unsupported { message, .. } => {
                assert_eq!(message, "tag name too long (max 64 characters)");
            }
            other => panic!("expected Unsupported, got {other:?}"),
        }
    }
}
