import { describe, expect, it } from "vitest";
import type { OrganizePlanItem } from "@/lib/api/organize";
import { groupPlan } from "./groupPlan";

function item(overrides: Partial<OrganizePlanItem>): OrganizePlanItem {
  return {
    media_id: 1,
    old_rel_path: "DCIM/100/IMG_0001.jpg",
    new_rel_path: "archive/2024/06/2024-06-15_IMG_0001.jpg",
    status: "planned",
    reason: null,
    ...overrides,
  };
}

describe("groupPlan", () => {
  it("groups planned items by the dirname of new_rel_path", () => {
    const groups = groupPlan([
      item({ media_id: 1, new_rel_path: "archive/2024/06/a.jpg" }),
      item({ media_id: 2, new_rel_path: "archive/2024/06/b.jpg" }),
      item({ media_id: 3, new_rel_path: "archive/2024/07/c.jpg" }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.folder === "archive/2024/06")?.count).toBe(2);
    expect(groups.find((g) => g.folder === "archive/2024/07")?.count).toBe(1);
  });

  it("excludes items whose status is not planned", () => {
    const groups = groupPlan([
      item({ media_id: 1, status: "planned" }),
      item({ media_id: 2, status: "skipped_dup" }),
      item({ media_id: 3, status: "moved" }),
      item({ media_id: 4, status: "failed" }),
      item({ media_id: 5, status: "skipped_collision" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(1);
  });

  it("sorts groups by folder name descending", () => {
    const groups = groupPlan([
      item({ media_id: 1, new_rel_path: "archive/2023/a.jpg" }),
      item({ media_id: 2, new_rel_path: "archive/2025/b.jpg" }),
      item({ media_id: 3, new_rel_path: "archive/2024/c.jpg" }),
    ]);

    expect(groups.map((g) => g.folder)).toEqual(["archive/2025", "archive/2024", "archive/2023"]);
  });

  it("limits rows to the first two per folder and reports the remainder in more", () => {
    const groups = groupPlan([
      item({ media_id: 1, new_rel_path: "archive/2024/a.jpg" }),
      item({ media_id: 2, new_rel_path: "archive/2024/b.jpg" }),
      item({ media_id: 3, new_rel_path: "archive/2024/c.jpg" }),
      item({ media_id: 4, new_rel_path: "archive/2024/d.jpg" }),
      item({ media_id: 5, new_rel_path: "archive/2024/e.jpg" }),
    ]);

    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].rows.map((r) => r.media_id)).toEqual([1, 2]);
    expect(groups[0].more).toBe(3);
  });

  it("reports more as 0 when a folder has two or fewer items", () => {
    const groups = groupPlan([item({ media_id: 1 }), item({ media_id: 2, old_rel_path: "b.jpg" })]);
    expect(groups[0].more).toBe(0);
    expect(groups[0].rows).toHaveLength(2);
  });

  it("treats a top-level new_rel_path (no slash) as folder ''", () => {
    const groups = groupPlan([item({ new_rel_path: "IMG_0001.jpg" })]);
    expect(groups[0].folder).toBe("");
  });

  it("returns an empty array for no items", () => {
    expect(groupPlan([])).toEqual([]);
  });
});
