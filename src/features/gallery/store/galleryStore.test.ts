import { beforeEach, describe, expect, it } from "vitest";
import { buildQuery, useGalleryStore } from "./galleryStore";

const initial = {
  typeFilter: "ALL" as const,
  sort: "NEWEST" as const,
  density: "Comfortable" as const,
  selectedIds: [] as number[],
  anchorIndex: null as number | null,
  missingOnly: false,
  query: "",
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

describe("selection", () => {
  it("defaults to an empty selection with no anchor", () => {
    const state = useGalleryStore.getState();
    expect(state.selectedIds).toEqual([]);
    expect(state.anchorIndex).toBeNull();
  });

  it("toggleSelected adds an id and sets the anchor to its index", () => {
    useGalleryStore.getState().toggleSelected(5, 2);
    const state = useGalleryStore.getState();
    expect(state.selectedIds).toEqual([5]);
    expect(state.anchorIndex).toBe(2);
  });

  it("toggleSelected removes an already-selected id and still updates the anchor", () => {
    useGalleryStore.getState().toggleSelected(5, 2);
    useGalleryStore.getState().toggleSelected(7, 4);
    useGalleryStore.getState().toggleSelected(5, 2);
    const state = useGalleryStore.getState();
    expect(state.selectedIds).toEqual([7]);
    expect(state.anchorIndex).toBe(2);
  });

  it("toggleSelected keeps selectedIds insertion-ordered", () => {
    useGalleryStore.getState().toggleSelected(9, 0);
    useGalleryStore.getState().toggleSelected(3, 1);
    useGalleryStore.getState().toggleSelected(6, 2);
    expect(useGalleryStore.getState().selectedIds).toEqual([9, 3, 6]);
  });

  it("selectRange adds ids without clearing the existing selection", () => {
    useGalleryStore.getState().toggleSelected(1, 0);
    useGalleryStore.getState().selectRange([2, 3, 4]);
    expect(useGalleryStore.getState().selectedIds).toEqual([1, 2, 3, 4]);
  });

  it("selectRange does not duplicate already-selected ids", () => {
    useGalleryStore.getState().toggleSelected(2, 1);
    useGalleryStore.getState().selectRange([1, 2, 3]);
    expect(useGalleryStore.getState().selectedIds).toEqual([2, 1, 3]);
  });

  it("selectRange does not change the anchor", () => {
    useGalleryStore.getState().toggleSelected(1, 0);
    useGalleryStore.getState().selectRange([2, 3]);
    expect(useGalleryStore.getState().anchorIndex).toBe(0);
  });

  it("clearSelection empties selectedIds and resets the anchor", () => {
    useGalleryStore.getState().toggleSelected(1, 0);
    useGalleryStore.getState().selectRange([2, 3]);
    useGalleryStore.getState().clearSelection();
    const state = useGalleryStore.getState();
    expect(state.selectedIds).toEqual([]);
    expect(state.anchorIndex).toBeNull();
  });

  it("does not persist the selection to localStorage", () => {
    useGalleryStore.getState().toggleSelected(1, 0);
    useGalleryStore.getState().setTypeFilter("RAW");

    const raw = localStorage.getItem("drophoto.gallery");
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string);
    expect(persisted.state).not.toHaveProperty("selectedIds");
    expect(persisted.state).not.toHaveProperty("anchorIndex");
  });

  it("setTypeFilter clears the selection when the filter actually changes", () => {
    useGalleryStore.getState().toggleSelected(1, 0);
    useGalleryStore.getState().setTypeFilter("RAW");
    const state = useGalleryStore.getState();
    expect(state.selectedIds).toEqual([]);
    expect(state.anchorIndex).toBeNull();
  });

  it("setTypeFilter to the same value does not clear the selection", () => {
    useGalleryStore.getState().toggleSelected(1, 0);
    useGalleryStore.getState().setTypeFilter("ALL");
    const state = useGalleryStore.getState();
    expect(state.selectedIds).toEqual([1]);
    expect(state.anchorIndex).toBe(0);
  });

  it("setSort clears the selection when the sort actually changes", () => {
    useGalleryStore.getState().toggleSelected(1, 0);
    useGalleryStore.getState().setSort("OLDEST");
    const state = useGalleryStore.getState();
    expect(state.selectedIds).toEqual([]);
    expect(state.anchorIndex).toBeNull();
  });

  it("setSort to the same value does not clear the selection", () => {
    useGalleryStore.getState().toggleSelected(1, 0);
    useGalleryStore.getState().setSort("NEWEST");
    const state = useGalleryStore.getState();
    expect(state.selectedIds).toEqual([1]);
    expect(state.anchorIndex).toBe(0);
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
      missing: false,
    });
  });

  it("maps NEWEST to taken_desc and ADDED to added_desc", () => {
    expect(buildQuery({ typeFilter: "ALL", sort: "NEWEST" }, 1, 0).sort).toBe("taken_desc");
    expect(buildQuery({ typeFilter: "ALL", sort: "ADDED" }, 1, 0).sort).toBe("added_desc");
  });

  it("defaults missing to false when missingOnly is omitted", () => {
    expect(buildQuery({ typeFilter: "ALL", sort: "NEWEST" }, 1, 0).missing).toBe(false);
  });

  it("passes missing: true through when missingOnly is set", () => {
    expect(buildQuery({ typeFilter: "ALL", sort: "NEWEST", missingOnly: true }, 1, 0).missing).toBe(
      true,
    );
  });
});

describe("missingOnly", () => {
  it("defaults to false", () => {
    expect(useGalleryStore.getState().missingOnly).toBe(false);
  });

  it("setMissingOnly updates the flag", () => {
    useGalleryStore.getState().setMissingOnly(true);
    expect(useGalleryStore.getState().missingOnly).toBe(true);
  });

  it("setMissingOnly clears the selection when the flag actually changes", () => {
    useGalleryStore.getState().toggleSelected(1, 0);
    useGalleryStore.getState().setMissingOnly(true);
    const state = useGalleryStore.getState();
    expect(state.selectedIds).toEqual([]);
    expect(state.anchorIndex).toBeNull();
  });

  it("setMissingOnly to the same value does not clear the selection", () => {
    useGalleryStore.getState().toggleSelected(1, 0);
    useGalleryStore.getState().setMissingOnly(false);
    const state = useGalleryStore.getState();
    expect(state.selectedIds).toEqual([1]);
    expect(state.anchorIndex).toBe(0);
  });

  it("is not persisted to localStorage", () => {
    useGalleryStore.getState().setMissingOnly(true);
    useGalleryStore.getState().setTypeFilter("RAW");

    const raw = localStorage.getItem("drophoto.gallery");
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string);
    expect(persisted.state).not.toHaveProperty("missingOnly");
  });
});
