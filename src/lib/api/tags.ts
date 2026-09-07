import { invokeApi } from "./client";

export type Tag = { id: number; name: string };

/** A [[Tag]] paired with how many media rows currently reference it — see `dp_core::TagWithCount`. Includes tags with `count: 0`. */
export type TagWithCount = { tag: Tag; count: number };

/**
 * A tag as the Tags page renders it: an album card with cover art — see
 * the `TagCard` Tauri command DTO (`src-tauri/src/commands/tags.rs`).
 * `thumb_path`/`has_thumb` are resolved server-side the same way a
 * gallery `MediaItem`'s are; `thumb_path` is `null` and `has_thumb` is
 * `false` for a tag with no media (or whose cover photo has no thumbnail
 * yet), in which case the card falls back to a placeholder.
 *
 * `cover_taken_at` is RFC3339 (or `null` for a tag with no cover) — the
 * same photo `thumb_path` was resolved from, per `TagWithCount`'s Rust
 * doc comment. It's the Tags page's "Recently updated" sort key; the
 * server's own row order is alphabetical by name regardless of this
 * field, so a caller wanting recency order must sort by it explicitly.
 */
export type TagCard = {
  tag: Tag;
  count: number;
  thumb_path: string | null;
  has_thumb: boolean;
  cover_taken_at: string | null;
};

export const listTags = () => invokeApi<Tag[]>("list_tags");

/** Every tag with its linked-media count and cover art, for the Tags page's album grid. */
export const listTagsWithCounts = () => invokeApi<TagCard[]>("list_tags_with_counts");

export const tagsForMedia = (mediaIds: number[]) =>
  invokeApi<[number, Tag][]>("tags_for_media", { mediaIds });

/**
 * Applies `add`/`remove` to every id in `mediaIds`. Passed through as-is
 * to `tag_media` — the command trims/validates `add` entries server-side
 * (empties dropped, over-length names refused).
 *
 * Doesn't itself trigger a sidecar sync: callers should follow a
 * successful mutation with `startSidecarSyncAll()` (see
 * `src/lib/api/sidecars.ts`).
 */
export const tagMedia = (input: { mediaIds: number[]; add: string[]; remove: number[] }) =>
  invokeApi<void>("tag_media", input);

/**
 * Renames tag `id` to `newName`. If `newName` collides case-insensitively
 * with a different existing tag, the server treats this as a **merge**
 * into that tag instead of erroring — see `rename_tag`'s Rust doc comment.
 * `newName` is trimmed/validated server-side the same way `tagMedia`'s
 * `add` entries are, except an empty result is refused rather than
 * dropped.
 */
export const renameTag = (input: { id: number; newName: string }) => invokeApi<void>("rename_tag", input);

/** Merges every tag in `fromIds` into `intoId` — see `merge_tags`'s Rust doc comment. */
export const mergeTags = (input: { fromIds: number[]; intoId: number }) =>
  invokeApi<void>("merge_tags", input);

/**
 * Deletes tag `id` and its links. Never touches any photo file — only
 * queues the affected rows' sidecars for a rewrite, like every other tag
 * mutation here.
 */
export const deleteTag = (id: number) => invokeApi<void>("delete_tag", { id });
