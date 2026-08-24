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

/**
 * Drops and refills the whole `media_fts` index from current catalog
 * state — see `dp_catalog::Catalog::rebuild_fts`. `SqliteCatalog::open`
 * already does this automatically on startup if it finds the index
 * empty while media rows exist, so this is only for the rarer case of a
 * drift discovered mid-session.
 */
export const rebuildFts = () => invokeApi<void>("rebuild_fts");
