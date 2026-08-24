import { invokeApi } from "./client";
import type { MediaItem } from "./media";

/**
 * Full-text search over file stems, tags, and camera — see
 * `dp_catalog::Catalog::search_media`. `limit` is clamped server-side to
 * the command's cap; the default here is just this client's starting
 * point, not the cap itself.
 */
export const searchMedia = (query: string, limit = 200) =>
  invokeApi<MediaItem[]>("search_media", { query, limit });
