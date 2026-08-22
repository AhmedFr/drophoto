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

  it("persists state changes to localStorage under the drophoto.gallery key", () => {
    useGalleryStore.getState().setTypeFilter("HEIF");
    useGalleryStore.getState().setSort("ADDED");
    useGalleryStore.getState().setDensity("Compact");

    const raw = localStorage.getItem("drophoto.gallery");
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string);
    expect(persisted.state).toEqual({ typeFilter: "HEIF", sort: "ADDED", density: "Compact" });
  });

  it("falls back to defaults for invalid persisted values on rehydrate", async () => {
    localStorage.setItem(
      "drophoto.gallery",
      JSON.stringify({ state: { typeFilter: "BOGUS", sort: "NOPE", density: "X" }, version: 1 }),
    );

    await useGalleryStore.persist.rehydrate();

    const state = useGalleryStore.getState();
    expect(state.typeFilter).toBe("ALL");
    expect(state.sort).toBe("NEWEST");
    expect(state.density).toBe("Comfortable");
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
