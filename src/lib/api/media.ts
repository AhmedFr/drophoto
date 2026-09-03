import { invokeApi } from "./client";

export type MediaKind = "photo" | "video";

export type MediaRow = {
  id: number;
  drive_id: number;
  rel_path: string;
  hash: string;
  size: number;
  kind: MediaKind;
  ext: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  taken_at: string | null;
  camera: string | null;
  lens: string | null;
  aperture: number | null;
  shutter: number | null;
  iso: number | null;
  focal_mm: number | null;
  lat: number | null;
  lon: number | null;
  missing_at: string | null;
  organized_at: string | null;
  source_id: number | null;
  place_id: number | null;
  /** The source file's on-disk modification time, as captured by the
   * scan that last wrote this row — see `dp_core::MediaRow::mtime`. */
  mtime: string | null;
};

export type MediaItem = {
  row: MediaRow;
  thumb_path: string;
  preview_path: string;
  drive_name: string;
  online: boolean;
  original_path: string | null;
  has_thumb: boolean;
};

export type MediaSort = "taken_desc" | "taken_asc" | "added_desc";

export type MediaQuery = {
  kinds: MediaKind[];
  exts: string[];
  sort: MediaSort;
  limit: number;
  offset: number;
  /** Restrict to media assigned to this place — see `dp_core::MediaQuery::place_id`. Omitted/`undefined` behaves the same as `null` (no restriction), since the Rust side defaults a missing field to `None`. */
  place_id?: number | null;
  /**
   * Filters on presence — see `dp_core::MediaQuery::missing`.
   * Omitted/`undefined` behaves the same as `null` (include every row
   * regardless of `missing_at`); `false` restricts to present rows,
   * `true` to rows the last scan of their drive+source didn't see.
   */
  missing?: boolean | null;
  /**
   * Full-text search over file stems, tags, place, and camera — see
   * `dp_core::MediaQuery::query`. Omitted/`undefined` (and, server-side,
   * an empty/whitespace-only string) behaves as no search filter.
   */
  query?: string;
  /**
   * Restrict to media linked to any of these tag ids — see
   * `dp_core::MediaQuery::tag_ids`. Omitted/`undefined` behaves the same
   * as an empty array (no restriction). The UI only ever sends at most one
   * id (the Tags page's tag filter chip).
   */
  tag_ids?: number[];
};

export const queryMedia = (query: MediaQuery) => invokeApi<MediaItem[]>("query_media", { query });

export const countMedia = (query: MediaQuery) => invokeApi<number>("count_media", { query });

export const getMedia = (id: number) => invokeApi<MediaItem>("get_media", { id });
