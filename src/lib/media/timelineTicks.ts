import type { LayoutItem } from "./layout";

export type Tick = {
  /** The month header's own label, e.g. "March 2019" — or "Undated". */
  label: string;
  /** Where the month begins, as a fraction of the scrubber's track. */
  offsetRatio: number;
  /** Whether this tick opens a year the previous surviving tick didn't belong to. */
  isYearStart: boolean;
};

/** "March 2019" -> "2019"; "Undated" has no year and stands as itself. */
export function yearOf(label: string): string {
  const parts = label.split(" ");
  return parts[parts.length - 1] ?? label;
}

/**
 * Reduces the layout's month headers into positions along the scrubber
 * track. Offsets come from the grid's own row geometry (real pixel
 * positions), so a tick sits exactly where its month begins — the whole
 * reason the gallery loads a full index rather than estimating.
 *
 * `rowOffsets` and `totalHeight` are in whatever coordinates the caller
 * uses to *drive* the scroll, so a tick's `offsetRatio` is directly the
 * position the handle must reach to land on that month — one denominator
 * for the labels, the handle and the pointer alike.
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
  layout.forEach((item, i) => {
    if (item.kind !== "header") return;
    all.push({
      label: item.label,
      // Clamped: a month inside the final viewport-worth of the grid can
      // never reach the top of the screen, so its tick belongs at the very
      // bottom of the track rather than past the end of it.
      offsetRatio: Math.min(1, Math.max(0, (rowOffsets[i] ?? 0) / totalHeight)),
      isYearStart: false,
    });
  });

  // Marked twice on purpose. The first pass is what lets `cull` know which
  // ticks open a year and so must be kept; the second re-derives the flags
  // over the survivors, because a year start whose predecessor was culled
  // may no longer open anything, and the tick after a culled year start
  // may now be the first of its year.
  return markYearStarts(cull(markYearStarts(all), maxTicks));
}

/** Flags each tick that opens a year the one before it didn't belong to. */
function markYearStarts(ticks: Tick[]): Tick[] {
  let previousYear: string | null = null;
  return ticks.map((tick) => {
    const year = yearOf(tick.label);
    const isYearStart = year !== previousYear;
    previousYear = year;
    return { ...tick, isYearStart };
  });
}

/**
 * Thins the ticks to at most `maxTicks`, keeping the ones that open a year
 * ahead of the ones that don't.
 *
 * Culling evenly across all the months would quietly delete years: the
 * track only ever draws a label for a tick that opens a year, and a year
 * whose single opening tick is dropped disappears from the track
 * altogether — half of them, for a library of twenty years of full months.
 * The years are the whole point of the track, so they are what survives;
 * the months between them fill whatever room is left.
 */
function cull(ticks: Tick[], maxTicks: number): Tick[] {
  if (maxTicks <= 0) return [];
  if (ticks.length <= maxTicks) return ticks;

  const starts = ticks.filter((t) => t.isYearStart);
  // More years than the track has room for (a library would need over a
  // century of them) — spread the years themselves and drop every month.
  if (starts.length >= maxTicks) return spread(starts, maxTicks);

  const kept = new Set(starts);
  const fill = new Set(
    spread(
      ticks.filter((t) => !kept.has(t)),
      maxTicks - starts.length,
    ),
  );
  return ticks.filter((t) => kept.has(t) || fill.has(t));
}

/** `count` ticks taken evenly from `ticks`, always including its ends. */
function spread(ticks: Tick[], count: number): Tick[] {
  if (count <= 0) return [];
  if (ticks.length <= count) return ticks;
  if (count === 1) return [ticks[0]];
  const step = (ticks.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => ticks[Math.round(i * step)]);
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

  // The last layout item that starts at or before `offset` — i.e. the one
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
