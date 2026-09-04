import { mockIPC } from "@tauri-apps/api/mocks";
import { listTags, listTagsWithCounts, tagsForMedia, tagMedia, renameTag, mergeTags, deleteTag } from "./tags";
import { ApiError } from "./client";

it("lists every tag", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") {
      return [
        { id: 1, name: "Family" },
        { id: 2, name: "Trip" },
      ];
    }
    return undefined;
  });
  await expect(listTags()).resolves.toEqual([
    { id: 1, name: "Family" },
    { id: 2, name: "Trip" },
  ]);
});

it("wraps structured errors from list_tags", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(listTags()).rejects.toBeInstanceOf(ApiError);
});

it("gets the tags for a set of media ids", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "tags_for_media") {
      received = args;
      return [
        [10, { id: 1, name: "Family" }],
        [11, { id: 2, name: "Trip" }],
      ];
    }
    return undefined;
  });
  await expect(tagsForMedia([10, 11])).resolves.toEqual([
    [10, { id: 1, name: "Family" }],
    [11, { id: 2, name: "Trip" }],
  ]);
  expect(received).toEqual({ mediaIds: [10, 11] });
});

it("wraps structured errors from tags_for_media", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(tagsForMedia([1])).rejects.toBeInstanceOf(ApiError);
});

it("tags and untags media, passing input through as-is", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "tag_media") {
      received = args;
      return null;
    }
    return undefined;
  });
  await tagMedia({ mediaIds: [1, 2], add: ["Family", ""], remove: [9] });
  expect(received).toEqual({ mediaIds: [1, 2], add: ["Family", ""], remove: [9] });
});

it("wraps structured errors from tag_media", async () => {
  mockIPC(() => {
    throw { code: "unsupported", message: "tag name too long (max 64 characters)" };
  });
  await expect(tagMedia({ mediaIds: [1], add: ["x".repeat(65)], remove: [] })).rejects.toBeInstanceOf(
    ApiError,
  );
});

it("lists every tag with its linked-media count", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags_with_counts") {
      return [
        { tag: { id: 1, name: "Family" }, count: 3 },
        { tag: { id: 2, name: "Trip" }, count: 0 },
      ];
    }
    return undefined;
  });
  await expect(listTagsWithCounts()).resolves.toEqual([
    { tag: { id: 1, name: "Family" }, count: 3 },
    { tag: { id: 2, name: "Trip" }, count: 0 },
  ]);
});

it("wraps structured errors from list_tags_with_counts", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(listTagsWithCounts()).rejects.toBeInstanceOf(ApiError);
});

it("renames a tag, passing id/newName through as-is", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "rename_tag") {
      received = args;
      return null;
    }
    return undefined;
  });
  await renameTag({ id: 1, newName: "Vacation" });
  expect(received).toEqual({ id: 1, newName: "Vacation" });
});

it("wraps structured errors from rename_tag", async () => {
  mockIPC(() => {
    throw { code: "unsupported", message: "tag name must not be empty" };
  });
  await expect(renameTag({ id: 1, newName: "" })).rejects.toBeInstanceOf(ApiError);
});

it("merges tags, passing fromIds/intoId through as-is", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "merge_tags") {
      received = args;
      return null;
    }
    return undefined;
  });
  await mergeTags({ fromIds: [1, 2], intoId: 3 });
  expect(received).toEqual({ fromIds: [1, 2], intoId: 3 });
});

it("wraps structured errors from merge_tags", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(mergeTags({ fromIds: [1], intoId: 2 })).rejects.toBeInstanceOf(ApiError);
});

it("deletes a tag by id", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "delete_tag") {
      received = args;
      return null;
    }
    return undefined;
  });
  await deleteTag(7);
  expect(received).toEqual({ id: 7 });
});

it("wraps structured errors from delete_tag", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(deleteTag(7)).rejects.toBeInstanceOf(ApiError);
});
