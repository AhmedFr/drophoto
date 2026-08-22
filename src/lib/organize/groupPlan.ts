import type { OrganizePlanItem } from "@/lib/api/organize";

export type PlanGroup = {
  folder: string;
  count: number;
  rows: OrganizePlanItem[];
  more: number;
};

/** How many rows of a group `PlanPreview` renders before collapsing the rest into `more`. */
const ROWS_PER_GROUP = 2;

/** The directory portion of a `/`-separated relative path, or `""` for a top-level path. */
export function dirname(relPath: string): string {
  const idx = relPath.lastIndexOf("/");
  return idx === -1 ? "" : relPath.slice(0, idx);
}

/**
 * Groups `planned` plan items by their destination folder (`dirname` of
 * `new_rel_path`), sorted by folder name descending. Items with any
 * other status (skipped, moved, failed) are excluded — the preview only
 * shows what's about to move. Each group keeps its first two rows for
 * display; `more` counts the rest.
 */
export function groupPlan(items: OrganizePlanItem[]): PlanGroup[] {
  const byFolder = new Map<string, OrganizePlanItem[]>();

  for (const item of items) {
    if (item.status !== "planned") continue;
    const folder = dirname(item.new_rel_path);
    const rows = byFolder.get(folder);
    if (rows) rows.push(item);
    else byFolder.set(folder, [item]);
  }

  return Array.from(byFolder.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([folder, rows]) => ({
      folder,
      count: rows.length,
      rows: rows.slice(0, ROWS_PER_GROUP),
      more: Math.max(0, rows.length - ROWS_PER_GROUP),
    }));
}
