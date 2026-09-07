import { expect, it } from "vitest";
import { mediaItem } from "@/test/mediaFactories";
import { rowAt } from "./hydration";

it("returns the row when it is the photo the timeline expects there", () => {
  expect(rowAt([mediaItem(1), mediaItem(2)], [1, 2], 1)?.row.id).toBe(2);
});

// The whole point: the row is present, just not this position's photo.
it("returns nothing when the row at that position is a different photo", () => {
  expect(rowAt([mediaItem(9), mediaItem(1)], [1, 2], 0)).toBeUndefined();
});

it("returns nothing for a position that hasn't been hydrated", () => {
  expect(rowAt([], [1, 2], 0)).toBeUndefined();
  expect(rowAt([undefined, mediaItem(2)], [1, 2], 0)).toBeUndefined();
});

// A position past the end of either array has no expected photo, so there
// is nothing a row there could legitimately be.
it("returns nothing when the timeline has no id for that position", () => {
  expect(rowAt([mediaItem(1)], [], 0)).toBeUndefined();
  expect(rowAt([mediaItem(1)], [1], 5)).toBeUndefined();
});
