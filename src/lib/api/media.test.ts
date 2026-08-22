import { mockIPC } from "@tauri-apps/api/mocks";
import { listMedia } from "./media";
import type { MediaItem } from "./media";

const item: MediaItem = {
  row: {
    id: 1,
    drive_id: 1,
    rel_path: "a.jpg",
    hash: "hash1",
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
  },
  thumb_path: "/tmp/thumbs/hash1/400.webp",
  drive_name: "Kodachrome",
  online: true,
};

it("invokes list_media with limit and offset and returns the items", async () => {
  let args: unknown;
  mockIPC((cmd, a) => {
    if (cmd === "list_media") {
      args = a;
      return [item];
    }
    return undefined;
  });

  const result = await listMedia(500, 0);

  expect(args).toEqual({ limit: 500, offset: 0 });
  expect(result).toEqual([item]);
});
