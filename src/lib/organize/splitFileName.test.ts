import { describe, expect, it } from "vitest";
import { splitFileName } from "./splitFileName";

describe("splitFileName", () => {
  it("splits a date-prefixed filename into date, rest, and ext", () => {
    expect(splitFileName("2024-06-15_IMG_4821.cr2")).toEqual({
      date: "2024-06-15",
      rest: "_IMG_4821",
      ext: ".cr2",
    });
  });

  it("returns an empty date when the stem has no leading date", () => {
    expect(splitFileName("IMG_4821.jpg")).toEqual({ date: "", rest: "IMG_4821", ext: ".jpg" });
  });

  it("returns an empty ext when there is no dot", () => {
    expect(splitFileName("2024-06-15_IMG_4821")).toEqual({
      date: "2024-06-15",
      rest: "_IMG_4821",
      ext: "",
    });
  });

  it("handles a bare extension-less, date-less name", () => {
    expect(splitFileName("README")).toEqual({ date: "", rest: "README", ext: "" });
  });
});
