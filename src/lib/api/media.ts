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
};

export type MediaItem = {
  row: MediaRow;
  thumb_path: string;
  drive_name: string;
  online: boolean;
};

export const listMedia = (limit: number, offset: number) =>
  invokeApi<MediaItem[]>("list_media", { limit, offset });
