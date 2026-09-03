import { describe, expect, it } from "vitest";
import { FEATURES } from "./features";

// Task 6.1: search folded into the gallery — the standalone `/search`
// page/feature module is gone, so nothing in the registry should route
// there or carry the "search" feature id.
describe("FEATURES", () => {
  it("no longer registers a /search route", () => {
    expect(FEATURES.some((f) => f.path === "/search")).toBe(false);
  });

  it("no longer registers a search feature id", () => {
    expect(FEATURES.some((f) => f.id === "search")).toBe(false);
  });
});
