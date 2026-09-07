import type { MediaIndexEntry, MediaItem } from "@/lib/api/media";

/**
 * A fully-populated `MediaItem` for tests, keyed off `id` so every derived
 * string (`rel_path`, `hash`, thumbnail paths) is distinct per item.
 * Overrides are shallow — pass a whole `row` to change a row field:
 *
 * ```ts
 * mediaItem(1, { row: { ...mediaItem(1).row, kind: "video" } })
 * ```
 */
export function mediaItem(id: number, overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    row: {
      id,
      drive_id: 1,
      rel_path: `photos/${id}.jpg`,
      hash: `hash${id}`,
      size: 1234,
      kind: "photo",
      ext: "jpg",
      width: 100,
      height: 200,
      duration_ms: null,
      taken_at: "2024-06-15T12:00:00Z",
      camera: null,
      lens: null,
      aperture: null,
      shutter: null,
      iso: null,
      focal_mm: null,
      lat: null,
      lon: null,
      missing_at: null,
      organized_at: null,
      source_id: null,
      place_id: null,
      mtime: null,
    },
    thumb_path: `/tmp/thumbs/hash${id}/400.webp`,
    preview_path: `/tmp/thumbs/hash${id}/2000.webp`,
    drive_name: "Kodachrome",
    online: true,
    original_path: null,
    has_thumb: true,
    ...overrides,
  };
}

/** A `MediaIndexEntry` matching `mediaItem(id)`'s geometry and date. */
export function indexEntry(id: number, overrides: Partial<MediaIndexEntry> = {}): MediaIndexEntry {
  return {
    id,
    // The real command serializes `+00:00` rather than `Z` — mirrored here
    // so tests exercise the same parsing path the app does.
    taken_at: "2024-06-15T12:00:00+00:00",
    width: 100,
    height: 200,
    kind: "photo",
    ...overrides,
  };
}

/**
 * The index entry the backend would return for a given `MediaItem` — used
 * wherever a test mocks `query_media` and `media_index` with the same set,
 * so the two stay in the offset parity the gallery relies on.
 */
export function entryFor(item: MediaItem): MediaIndexEntry {
  return {
    id: item.row.id,
    taken_at: item.row.taken_at,
    width: item.row.width,
    height: item.row.height,
    kind: item.row.kind,
  };
}
