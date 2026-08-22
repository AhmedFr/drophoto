import { beforeEach, describe, expect, it } from "vitest";
import { buildQuery, useGalleryStore } from "./galleryStore";

const initial = {
  typeFilter: "ALL" as const,
  sort: "NEWEST" as const,
  density: "Comfortable" as const,
};

beforeEach(() => {
  useGalleryStore.setState(initial);
  useGalleryStore.persist.clearStorage();
});

describe("useGalleryStore", () => {
  it("defaults to ALL / NEWEST / Comfortable", () => {
    const state = useGalleryStore.getState();
    expect(state.typeFilter).toBe("ALL");
    expect(state.sort).toBe("NEWEST");
    expect(state.density).toBe("Comfortable");
  });

  it("setTypeFilter updates the type filter", () => {
    useGalleryStore.getState().setTypeFilter("RAW");
    expect(useGalleryStore.getState().typeFilter).toBe("RAW");
  });

  it("setSort updates the sort", () => {
    useGalleryStore.getState().setSort("OLDEST");
    expect(useGalleryStore.getState().sort).toBe("OLDEST");
  });

  it("setDensity updates the density", () => {
    useGalleryStore.getState().setDensity("Dense");
    expect(useGalleryStore.getState().density).toBe("Dense");
  });
});

describe("buildQuery", () => {
  it("maps state, limit and offset into a MediaQuery", () => {
    expect(buildQuery({ typeFilter: "VIDEO", sort: "OLDEST" }, 500, 1000)).toEqual({
      kinds: ["video"],
      exts: [],
      sort: "taken_asc",
      limit: 500,
      offset: 1000,
    });
  });

  it("maps NEWEST to taken_desc and ADDED to added_desc", () => {
    expect(buildQuery({ typeFilter: "ALL", sort: "NEWEST" }, 1, 0).sort).toBe("taken_desc");
    expect(buildQuery({ typeFilter: "ALL", sort: "ADDED" }, 1, 0).sort).toBe("added_desc");
  });
});
