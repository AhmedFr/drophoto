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
};

export const queryMedia = (query: MediaQuery) => invokeApi<MediaItem[]>("query_media", { query });

export const countMedia = (query: MediaQuery) => invokeApi<number>("count_media", { query });

export const getMedia = (id: number) => invokeApi<MediaItem>("get_media", { id });
