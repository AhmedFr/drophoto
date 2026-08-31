import { mockIPC } from "@tauri-apps/api/mocks";
import { countMedia, getMedia, queryMedia } from "./media";
import type { MediaItem, MediaQuery } from "./media";

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
    organized_at: null,
    source_id: null,
    place_id: null,
    mtime: null,
  },
  thumb_path: "/tmp/thumbs/hash1/400.webp",
  preview_path: "/tmp/thumbs/hash1/2000.webp",
  drive_name: "Kodachrome",
  online: true,
  original_path: null,
  has_thumb: true,
};

const query: MediaQuery = {
  kinds: [],
  exts: [],
  sort: "taken_desc",
  limit: 500,
  offset: 0,
};

it("invokes query_media with the query and returns the items", async () => {
  let args: unknown;
  mockIPC((cmd, a) => {
    if (cmd === "query_media") {
      args = a;
      return [item];
    }
    return undefined;
  });

  const result = await queryMedia(query);

  expect(args).toEqual({ query });
  expect(result).toEqual([item]);
});

it("invokes count_media with the query and returns the count", async () => {
  let args: unknown;
  mockIPC((cmd, a) => {
    if (cmd === "count_media") {
      args = a;
      return 42;
    }
    return undefined;
  });

  const result = await countMedia(query);

  expect(args).toEqual({ query });
  expect(result).toBe(42);
});

it("round-trips place_id in the query sent to query_media", async () => {
  let args: unknown;
  mockIPC((cmd, a) => {
    if (cmd === "query_media") {
      args = a;
      return [];
    }
    return undefined;
  });

  const placeQuery: MediaQuery = { ...query, place_id: 7 };
  await queryMedia(placeQuery);

  expect(args).toEqual({ query: placeQuery });
});

it("invokes get_media with the id and returns the item", async () => {
  let args: unknown;
  mockIPC((cmd, a) => {
    if (cmd === "get_media") {
      args = a;
      return item;
    }
    return undefined;
  });

  const result = await getMedia(1);

  expect(args).toEqual({ id: 1 });
  expect(result).toEqual(item);
});
