import { monthKey, monthLabel } from "./format";

/**
 * The minimum a tile needs to be *placed*; hydrated detail (thumbnail,
 * drive, badges) arrives separately, chunk by chunk. Structurally a
 * `MediaIndexEntry`, so the gallery's timeline index feeds this directly.
 */
export type LayoutEntry = {
  id: number;
  taken_at: string | null;
  width: number | null;
  height: number | null;
};

export type Tile = { entry: LayoutEntry; width: number; height: number; index: number };

export type LayoutItem =
  | { kind: "header"; key: string; label: string; count: number; ids: number[]; height: number }
  | { kind: "row"; key: string; tiles: Tile[]; height: number };

export const HEADER_HEIGHT = 52;
export const GAP = 8;

const MIN_RATIO = 0.3;
const MAX_RATIO = 4;

function tileRatio(entry: LayoutEntry): number {
  const { width, height } = entry;
  const ratio = width && height && width > 0 && height > 0 ? width / height : 4 / 3;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

type Placed = { entry: LayoutEntry; ratio: number; index: number };

function closeRow(key: string, rowIndex: number, placed: Placed[], height: number): LayoutItem {
  const tiles: Tile[] = placed.map(({ entry, ratio, index }) => ({
    entry,
    width: ratio * height,
    height,
    index,
  }));
  return { kind: "row", key: `r:${key}:${rowIndex}`, tiles, height };
}

function packGroup(
  group: LayoutEntry[],
  offset: number,
  key: string,
  containerWidth: number,
  targetRowHeight: number,
): LayoutItem[] {
  const rows: LayoutItem[] = [];
  let current: Placed[] = [];
  let sumRatio = 0;
  let rowIndex = 0;

  group.forEach((entry, i) => {
    const ratio = tileRatio(entry);
    current.push({ entry, ratio, index: offset + i });
    sumRatio += ratio;
    const width = sumRatio * targetRowHeight + GAP * (current.length - 1);
    if (width >= containerWidth) {
      const height = (containerWidth - GAP * (current.length - 1)) / sumRatio;
      rows.push(closeRow(key, rowIndex++, current, height));
      current = [];
      sumRatio = 0;
    }
  });

  if (current.length > 0) {
    rows.push(closeRow(key, rowIndex++, current, targetRowHeight));
  }

  return rows;
}

export function buildLayout(
  entries: LayoutEntry[],
  containerWidth: number,
  targetRowHeight: number,
): LayoutItem[] {
  if (containerWidth <= 0) return [];

  const layout: LayoutItem[] = [];
  let i = 0;
  while (i < entries.length) {
    const monthKeyValue = monthKey(entries[i].taken_at);
    let j = i + 1;
    while (j < entries.length && monthKey(entries[j].taken_at) === monthKeyValue) j++;

    const group = entries.slice(i, j);
    const label = monthKeyValue === "undated" ? "Undated" : monthLabel(entries[i].taken_at);
    // Include the group's start index (`i`) so that when a month recurs
    // non-consecutively (e.g. after an ADDED sort), each occurrence still
    // gets a positionally unique key instead of colliding on `monthKey`.
    const groupKey = `${monthKeyValue}:${i}`;
    layout.push({
      kind: "header",
      key: `h:${groupKey}`,
      label,
      count: group.length,
      // The group's media ids, in the same order as the group itself — used
      // by `MonthHeader`'s "select all in this section" action. Kept
      // separate from `Tile.index` (a position in the timeline index)
      // since ids are what the selection store actually tracks.
      ids: group.map((e) => e.id),
      height: HEADER_HEIGHT,
    });
    layout.push(...packGroup(group, i, groupKey, containerWidth, targetRowHeight));

    i = j;
  }

  return layout;
}
