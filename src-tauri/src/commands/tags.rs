use crate::state::AppState;
use chrono::{DateTime, Utc};
use dp_core::{DpError, DpResult, Tag, TagWithCount};
use dp_thumbs::ThumbStore;
use tauri::State;

/// Longest a tag name is allowed to be, after trimming. Chosen to keep
/// tags readable in chips/lists rather than for any storage limit.
const MAX_TAG_NAME_LEN: usize = 64;

/// A tag as the Tags page renders it: an album card with cover art.
/// `thumb_path`/`has_thumb` are resolved here rather than in the catalog
/// for the same reason `to_item` does it — the thumbnail store is an
/// app-layer concern the catalog knows nothing about. `cover_taken_at` is
/// carried straight through from the catalog (no resolution needed) so
/// the frontend can sort by it — see `TagWithCount::cover_taken_at`.
#[derive(serde::Serialize)]
pub struct TagCard {
    pub tag: Tag,
    pub count: u64,
    pub thumb_path: Option<String>,
    pub has_thumb: bool,
    pub cover_taken_at: Option<DateTime<Utc>>,
}

/// Maps a catalog [`TagWithCount`] into the [`TagCard`] shape sent to the
/// frontend: `cover_hash` resolved into a thumbnail path through `store`,
/// mirroring `media_item::to_item`'s split between "the catalog returns a
/// hash" and "the command layer turns it into `thumb_path` + `has_thumb`".
/// A tag with no `cover_hash` (no linked media) gets `thumb_path: None`,
/// `has_thumb: false` — the same shape a hash whose thumbnail was never
/// generated gets, so the frontend renders one placeholder treatment for
/// both. `cover_taken_at` needs no such resolution — it isn't a path, so
/// it's passed through unchanged.
fn to_card(store: &ThumbStore, t: TagWithCount) -> TagCard {
    let thumb_path = t
        .cover_hash
        .as_ref()
        .map(|h| store.path(h, 400).to_string_lossy().into_owned());
    let has_thumb = t.cover_hash.as_ref().is_some_and(|h| store.exists(h, 400));
    TagCard {
        tag: t.tag,
        count: t.count,
        thumb_path,
        has_thumb,
        cover_taken_at: t.cover_taken_at,
    }
}

#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, DpError> {
    state.catalog.list_tags().await
}

/// Every tag with its linked-media count and cover art, for the Tags
/// page's album grid — see [`to_card`].
#[tauri::command]
pub async fn list_tags_with_counts(state: State<'_, AppState>) -> Result<Vec<TagCard>, DpError> {
    let tags = state.catalog.list_tags_with_counts().await?;
    Ok(tags.into_iter().map(|t| to_card(&state.store, t)).collect())
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
    use chrono::TimeZone;

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

    fn tag_with_count(cover_hash: Option<&str>) -> TagWithCount {
        TagWithCount {
            tag: Tag {
                id: 1,
                name: "Trip".into(),
            },
            count: 3,
            cover_hash: cover_hash.map(String::from),
            cover_taken_at: None,
        }
    }

    #[test]
    fn to_card_resolves_a_thumb_path_under_the_store_root_when_a_cover_exists() {
        let dir = tempfile::tempdir().unwrap();
        let store = ThumbStore::new(dir.path());

        let card = to_card(&store, tag_with_count(Some("abc123")));

        assert_eq!(
            card.thumb_path,
            Some(
                dir.path()
                    .join("abc123")
                    .join("400.webp")
                    .to_string_lossy()
                    .into_owned()
            )
        );
        assert_eq!(card.tag.name, "Trip");
        assert_eq!(card.count, 3);
    }

    #[test]
    fn to_card_has_thumb_is_false_when_no_thumbnail_was_ever_written() {
        let dir = tempfile::tempdir().unwrap();
        let store = ThumbStore::new(dir.path());

        let card = to_card(&store, tag_with_count(Some("abc123")));

        assert!(!card.has_thumb);
    }

    #[test]
    fn to_card_has_thumb_is_true_when_a_400px_thumbnail_exists_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let store = ThumbStore::new(dir.path());
        let thumb_path = store.path("abc123", 400);
        std::fs::create_dir_all(thumb_path.parent().unwrap()).unwrap();
        std::fs::write(&thumb_path, b"fake webp bytes").unwrap();

        let card = to_card(&store, tag_with_count(Some("abc123")));

        assert!(card.has_thumb);
    }

    #[test]
    fn to_card_has_no_thumb_path_when_the_tag_has_no_cover() {
        let dir = tempfile::tempdir().unwrap();
        let store = ThumbStore::new(dir.path());

        let card = to_card(&store, tag_with_count(None));

        assert_eq!(card.thumb_path, None);
        assert!(!card.has_thumb);
    }

    #[test]
    fn to_card_carries_cover_taken_at_through_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let store = ThumbStore::new(dir.path());
        let taken_at = chrono::Utc.with_ymd_and_hms(2024, 1, 1, 12, 0, 0).unwrap();
        let mut input = tag_with_count(Some("abc123"));
        input.cover_taken_at = Some(taken_at);

        let card = to_card(&store, input);

        assert_eq!(card.cover_taken_at, Some(taken_at));
    }
}
