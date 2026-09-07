import type { LayoutItem } from "./layout";

export type Tick = {
  /** The month header's own label, e.g. "March 2019" — or "Undated". */
  label: string;
  /** Where the month begins, as a fraction of the grid's total height. */
  offsetRatio: number;
  /** Whether this tick opens a year the previous tick didn't belong to. */
  isYearStart: boolean;
};

/**
 * Reduces the layout's month headers into positions along the scrubber
 * track. Offsets come from the grid's own row geometry (real pixel
 * positions), so a tick sits exactly where its month begins — the whole
 * reason the gallery loads a full index rather than estimating.
 *
 * `maxTicks` caps how many labels render so they never overlap on a short
 * track; the first and last always survive so the track's ends stay
 * anchored to the library's real range.
 */
export function buildTicks(
  layout: LayoutItem[],
  rowOffsets: number[],
  totalHeight: number,
  maxTicks: number,
): Tick[] {
  if (totalHeight <= 0 || layout.length === 0) return [];

  const all: Tick[] = [];
  let previousYear: string | null = null;
  layout.forEach((item, i) => {
    if (item.kind !== "header") return;
    // "March 2019" -> "2019"; "Undated" has no year part, so it stands as
    // its own — two consecutive undated headers can't both read as the
    // start of something new.
    const parts = item.label.split(" ");
    const year = parts[parts.length - 1] ?? "";
    all.push({
      label: item.label,
      offsetRatio: (rowOffsets[i] ?? 0) / totalHeight,
      isYearStart: year !== previousYear,
    });
    previousYear = year;
  });

  return cull(all, maxTicks);
}

/** Keeps the first and last tick and spreads the rest evenly between them. */
function cull(ticks: Tick[], maxTicks: number): Tick[] {
  if (ticks.length <= maxTicks || maxTicks < 2) return ticks.slice(0, Math.max(maxTicks, 0));
  const step = (ticks.length - 1) / (maxTicks - 1);
  return Array.from({ length: maxTicks }, (_, i) => ticks[Math.round(i * step)]);
}

/**
 * The `entries` index of the photo sitting at the top of the viewport when
 * the grid is scrolled to `offset` — the source of the date the scrubber's
 * pill shows.
 *
 * Deliberately a different source from `buildTicks`: the ticks come from
 * month headers, which is all a year label needs, but only the index knows
 * an individual photo's date. Returns `null` when the layout holds no rows
 * (nothing laid out, or headers only).
 *
 * `rowOffsets` is ascending, so the search is a binary one — this runs on
 * every pointer move of a scrub, over a layout that can be tens of
 * thousands of rows long.
 */
export function tileIndexAtOffset(
  layout: LayoutItem[],
  rowOffsets: number[],
  offset: number,
): number | null {
  if (layout.length === 0) return null;

  // The last layout item that starts at or above `offset` — i.e. the one
  // occupying the top of the viewport.
  let lo = 0;
  let hi = layout.length - 1;
  let at = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((rowOffsets[mid] ?? 0) <= offset) {
      at = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  // A header at the top means the user has just scrolled a new month into
  // view, so the answer is the month being arrived at, not the tail of the
  // one being left — look forward first, and only fall back to looking
  // back when the layout ends in a header.
  for (let i = at; i < layout.length; i++) {
    const item = layout[i];
    if (item.kind === "row") return item.tiles[0]?.index ?? null;
  }
  for (let i = at - 1; i >= 0; i--) {
    const item = layout[i];
    if (item.kind === "row") return item.tiles[0]?.index ?? null;
  }
  return null;
}
