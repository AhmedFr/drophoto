import { describe, expect, it } from "vitest";
import { TYPE_FILTERS, typeFilterToQuery } from "./typeFilter";

describe("typeFilterToQuery", () => {
  it("maps ALL to no kinds or exts filter", () => {
    expect(typeFilterToQuery("ALL")).toEqual({ kinds: [], exts: [] });
  });

  it("maps JPG to jpg/jpeg extensions", () => {
    expect(typeFilterToQuery("JPG")).toEqual({ kinds: [], exts: ["jpg", "jpeg"] });
  });

  it("maps RAW to the RAW extensions", () => {
    expect(typeFilterToQuery("RAW")).toEqual({
      kinds: [],
      exts: ["raf", "cr2", "cr3", "arw", "nef", "dng", "orf", "rw2"],
    });
  });

  it("maps HEIF to heic/heif extensions", () => {
    expect(typeFilterToQuery("HEIF")).toEqual({ kinds: [], exts: ["heic", "heif"] });
  });

  it("maps PNG to the png extension", () => {
    expect(typeFilterToQuery("PNG")).toEqual({ kinds: [], exts: ["png"] });
  });

  it("maps VIDEO to the video kind with no ext filter", () => {
    expect(typeFilterToQuery("VIDEO")).toEqual({ kinds: ["video"], exts: [] });
  });
});

describe("TYPE_FILTERS", () => {
  it("lists all filters in chip order", () => {
    expect(TYPE_FILTERS).toEqual(["ALL", "JPG", "RAW", "HEIF", "PNG", "VIDEO"]);
  });
});
