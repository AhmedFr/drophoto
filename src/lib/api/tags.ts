import { invokeApi } from "./client";

export type Tag = { id: number; name: string };

/** A [[Tag]] paired with how many media rows currently reference it — see `dp_core::TagWithCount`. Includes tags with `count: 0`. */
export type TagWithCount = { tag: Tag; count: number };

export const listTags = () => invokeApi<Tag[]>("list_tags");

/** Every tag with its linked-media count, for the Tags page. */
export const listTagsWithCounts = () => invokeApi<TagWithCount[]>("list_tags_with_counts");

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
