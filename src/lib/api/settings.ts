import { invokeApi } from "./client";

/**
 * Preview-quality steps — the longest edge (px) the "preview" thumbnail
 * slot is rendered/regenerated at. Shared *by value* with
 * `dp_core::PREVIEW_EDGE_COMPACT`/`PREVIEW_EDGE_BALANCED`/`PREVIEW_EDGE_MAX`
 * — keep both in sync. The `400.webp` thumb slot is never affected; only
 * the `2000.webp` "preview" slot's rendered edge changes — its filename
 * always stays `2000.webp`, see `dp-thumbs`'s `PREVIEW_SLOT` docs.
 */
export const PREVIEW_EDGES = {
  compact: 800,
  balanced: 1200,
  max: 2000,
} as const;

export type PreviewQuality = keyof typeof PREVIEW_EDGES;

/** Persisted app-wide settings — mirrors `dp_core::AppSettings`. */
export type AppSettings = {
  preview_edge: number;
};

/**
 * A breakdown of the app's own on-disk footprint (never the user's
 * photos/drives) — mirrors `dp_core::StorageUsage`.
 */
export type StorageUsage = {
  thumbs_400_bytes: number;
  previews_bytes: number;
  catalog_bytes: number;
  total_bytes: number;
  file_count: number;
};

/** Current app-wide settings. */
export const getSettings = () => invokeApi<AppSettings>("get_settings");

/**
 * Sets the preview-quality edge (px) — one of `PREVIEW_EDGES`' values,
 * though nothing here enforces that. Resolves to whether the change is a
 * *downscale* from what was previously set, i.e. whether
 * `startRegenPreviews` would actually have anything to shrink; raising
 * quality never triggers a regen on its own (see the Rust command's doc
 * comment) — that needs a full rescan with the originals available.
 */
export const setPreviewQuality = (edge: number) => invokeApi<boolean>("set_preview_quality", { edge });

/** The app's current storage breakdown — computed on call, not polled. */
export const storageUsage = () => invokeApi<StorageUsage>("storage_usage");

/**
 * Starts (or reuses, if one is already running) the global preview-regen
 * sweep, targeting the currently configured preview edge.
 */
export const startRegenPreviews = () => invokeApi<string>("start_regen_previews");

/**
 * Danger-zone action: permanently deletes the app's own catalog and
 * cached thumbnails, then exits the process. Never touches the user's
 * photos, drives, or `.xmp` sidecar files. The promise this returns will
 * generally never resolve — the app process exits as part of handling the
 * command — so callers should treat firing it as the point of no return,
 * not something to await for a response.
 */
export const resetAppData = () => invokeApi<void>("reset_app_data");
