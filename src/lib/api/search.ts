import { invokeApi } from "./client";

/**
 * Drops and refills the whole `media_fts` index from current catalog
 * state — see `dp_catalog::Catalog::rebuild_fts`. `SqliteCatalog::open`
 * already does this automatically on startup if it finds the index
 * empty while media rows exist, so this is only for the rarer case of a
 * drift discovered mid-session.
 */
export const rebuildFts = () => invokeApi<void>("rebuild_fts");
