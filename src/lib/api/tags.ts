import { invokeApi } from "./client";

export type Tag = { id: number; name: string };

export const listTags = () => invokeApi<Tag[]>("list_tags");

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
