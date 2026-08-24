import { mockIPC } from "@tauri-apps/api/mocks";
import { searchMedia } from "./search";
import { ApiError } from "./client";
import type { MediaItem } from "./media";

function item(id: number): MediaItem {
  return {
    row: {
      id,
      drive_id: 1,
      rel_path: `photos/${id}.jpg`,
      hash: `hash${id}`,
      size: 100,
      kind: "photo",
      ext: "jpg",
      width: 100,
      height: 100,
      duration_ms: null,
      taken_at: null,
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
    },
    thumb_path: `/thumbs/${id}/400.webp`,
    preview_path: `/thumbs/${id}/2000.webp`,
    drive_name: "Kodachrome",
    online: true,
    original_path: `/Volumes/Kodachrome/photos/${id}.jpg`,
    has_thumb: true,
  };
}

it("searches media, round-tripping the query and limit", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "search_media") {
      received = args;
      return [item(1), item(2)];
    }
    return undefined;
  });

  await expect(searchMedia("beach", 50)).resolves.toEqual([item(1), item(2)]);
  expect(received).toEqual({ query: "beach", limit: 50 });
});

it("defaults limit to 200 when not passed", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "search_media") {
      received = args;
      return [];
    }
    return undefined;
  });

  await searchMedia("beach");
  expect(received).toEqual({ query: "beach", limit: 200 });
});

it("wraps structured errors from search_media", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(searchMedia("beach")).rejects.toBeInstanceOf(ApiError);
});
