import { invokeApi } from "./client";

/**
 * Starts a background sync for every online drive with pending tag
 * changes to flush to XMP sidecars — see
 * `src-tauri/src/commands/sidecars.rs::start_sidecar_sync_all`. Returns
 * the ids of every job actually started (a drive with another job
 * already running on it is skipped silently, not an error).
 */
export const startSidecarSyncAll = () => invokeApi<string[]>("start_sidecar_sync_all");
