import { invokeApi } from "./client";

/**
 * Starts a background sync for every online drive with pending tag
 * changes to flush to XMP sidecars — see
 * `src-tauri/src/commands/sidecars.rs::start_sidecar_sync_all`. Returns
 * the ids of every job actually started (a drive with another job
 * already running on it is skipped silently, not an error).
 */
export const startSidecarSyncAll = () => invokeApi<string[]>("start_sidecar_sync_all");

/** A drive's sidecar coverage for Settings' SIDECARS panel — mirrors `dp_core::SidecarHealth`. */
export type SidecarHealth = {
  /** How many of the drive's media rows carry at least one tag. */
  tagged: number;
  /** How many of the drive's media rows are queued for the next sidecar sync sweep. */
  pending: number;
};

/** `driveId`'s tagged/pending sidecar counts — see `SidecarHealth`. */
export const sidecarHealth = (driveId: number) => invokeApi<SidecarHealth>("sidecar_health", { driveId });

/**
 * Stats a `.xmp` sidecar for every tagged row on `driveId` and flags
 * every row whose sidecar is missing as pending (queued for the next
 * `startSidecarSyncAll` sweep) — the "CHECK FILES" action in Settings'
 * SIDECARS panel. Read-only on disk: never writes to the user's photos
 * or `.xmp` files itself. Returns how many missing sidecars were found
 * and newly queued. Rejects (`ApiError`, code `"not_found"`) if `driveId`
 * is offline.
 */
export const checkSidecarFiles = (driveId: number) => invokeApi<number>("check_sidecar_files", { driveId });
