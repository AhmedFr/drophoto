import type { MediaItem } from "@/lib/api/media";
import { monthKey, monthLabel } from "./format";

export type Tile = { item: MediaItem; width: number; height: number; index: number };

export type LayoutItem =
  | { kind: "header"; key: string; label: string; count: number; height: number }
  | { kind: "row"; key: string; tiles: Tile[]; height: number };

export const HEADER_HEIGHT = 52;
export const GAP = 8;

const MIN_RATIO = 0.3;
const MAX_RATIO = 4;

function tileRatio(item: MediaItem): number {
  const { width, height } = item.row;
  const ratio = width && height && width > 0 && height > 0 ? width / height : 4 / 3;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

type Placed = { item: MediaItem; ratio: number; index: number };

function closeRow(key: string, rowIndex: number, placed: Placed[], height: number): LayoutItem {
  const tiles: Tile[] = placed.map(({ item, ratio, index }) => ({
    item,
    width: ratio * height,
    height,
    index,
  }));
  return { kind: "row", key: `r:${key}:${rowIndex}`, tiles, height };
}

function packGroup(
  group: MediaItem[],
  offset: number,
  key: string,
  containerWidth: number,
  targetRowHeight: number,
): LayoutItem[] {
  const rows: LayoutItem[] = [];
  let current: Placed[] = [];
  let sumRatio = 0;
  let rowIndex = 0;

  group.forEach((item, i) => {
    const ratio = tileRatio(item);
    current.push({ item, ratio, index: offset + i });
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
  items: MediaItem[],
  containerWidth: number,
  targetRowHeight: number,
): LayoutItem[] {
  if (containerWidth <= 0) return [];

  const layout: LayoutItem[] = [];
  let i = 0;
  while (i < items.length) {
    const monthKeyValue = monthKey(items[i].row.taken_at);
    let j = i + 1;
    while (j < items.length && monthKey(items[j].row.taken_at) === monthKeyValue) j++;

    const group = items.slice(i, j);
    const label = monthKeyValue === "undated" ? "Undated" : monthLabel(items[i].row.taken_at);
    // Include the group's start index (`i`) so that when a month recurs
    // non-consecutively (e.g. after an ADDED sort), each occurrence still
    // gets a positionally unique key instead of colliding on `monthKey`.
    const groupKey = `${monthKeyValue}:${i}`;
    layout.push({
      kind: "header",
      key: `h:${groupKey}`,
      label,
      count: group.length,
      height: HEADER_HEIGHT,
    });
    layout.push(...packGroup(group, i, groupKey, containerWidth, targetRowHeight));

    i = j;
  }

  return layout;
}
