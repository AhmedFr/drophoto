import type { LayoutItem } from "./layout";
import { buildTicks, tileIndexAtOffset, yearOf } from "./timelineTicks";

let seq = 0;

function header(label: string): LayoutItem {
  return { kind: "header", key: `h:${seq++}`, label, count: 1, ids: [seq], height: 52 };
}

function row(...indices: number[]): LayoutItem {
  const tiles = (indices.length > 0 ? indices : [seq]).map((index) => ({
    entry: { id: index + 1, taken_at: null, width: 100, height: 100 },
    width: 100,
    height: 200,
    index,
  }));
  return { kind: "row", key: `r:${seq++}`, tiles, height: 200 };
}

it("emits a tick per month header at its proportional offset", () => {
  const layout = [header("March 2019"), row(), header("February 2019"), row()];
  const offsets = [0, 52, 252, 304];

  const ticks = buildTicks(layout, offsets, 504, 100);

  expect(ticks).toEqual([
    { label: "March 2019", offsetRatio: 0, isYearStart: true },
    { label: "February 2019", offsetRatio: 252 / 504, isYearStart: false },
  ]);
});

it("marks a tick as a year start when its year differs from the previous tick's", () => {
  const layout = [header("January 2020"), row(), header("December 2019"), row()];
  const ticks = buildTicks(layout, [0, 52, 252, 304], 504, 100);

  expect(ticks.map((t) => t.isYearStart)).toEqual([true, true]);
});

it("culls ticks down to maxTicks, always keeping the first and last", () => {
  const layout = Array.from({ length: 24 }, (_, i) => header(`Month ${i}`)).flatMap((h) => [
    h,
    row(),
  ]);
  const offsets = layout.map((_, i) => i * 50);

  const ticks = buildTicks(layout, offsets, 2400, 5);

  expect(ticks).toHaveLength(5);
  expect(ticks[0].label).toBe("Month 0");
  expect(ticks[4].label).toBe("Month 23");
});

it("returns no ticks for an empty layout", () => {
  expect(buildTicks([], [], 0, 10)).toEqual([]);
});

// "Undated" carries no year, so it must not be mistaken for one — two
// consecutive undated headers would otherwise both read as year starts.
it("treats the Undated header's own label as its year", () => {
  const layout = [header("Undated"), row(), header("Undated"), row()];
  const ticks = buildTicks(layout, [0, 52, 252, 304], 504, 100);

  expect(ticks.map((t) => t.isYearStart)).toEqual([true, false]);
});

// The track draws a label only for a tick that opens a year, so a year
// whose one opening tick is culled vanishes from the track entirely —
// evenly-spaced culling silently deleted half of them for a library this
// size, which is the ordinary case for this app.
it("keeps every year's label when culling a library of twenty years", () => {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const layout: LayoutItem[] = [];
  for (let year = 2006; year <= 2025; year++) {
    for (const month of months) layout.push(header(`${month} ${year}`), row());
  }
  const offsets = layout.map((_, i) => i * 50);

  // 240 months down to 60 ticks — a quarter of them survive.
  const ticks = buildTicks(layout, offsets, layout.length * 50, 60);

  const years = ticks.filter((t) => t.isYearStart).map((t) => t.label.split(" ")[1]);
  expect(new Set(years).size).toBe(20);
  // One label per year, and no year labelled twice.
  expect(years).toHaveLength(20);
});

// The library this app is actually for: two decades of photos where one
// year was a quiet one and contributed a single month. Spreading the ticks
// evenly picks by position, so a year holding one header in a set of
// hundreds is exactly the one that gets skipped — and since the track only
// draws a label for a tick that opens a year, that year disappears from
// the scrubber entirely. Keeping the year starts ahead of the months is
// what stops it, and this is the shape that proves it: culling this layout
// with a plain even spread drops 2011.
it("keeps a year that contributed a single month when culling hundreds of headers", () => {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const layout: LayoutItem[] = [];
  const yearsInData: string[] = [];
  for (let year = 2004; year <= 2025; year++) {
    // 2011 is the sparse one: a single month against everyone else's
    // twelve.
    const inYear = year === 2011 ? ["July"] : months;
    for (const month of inYear) layout.push(header(`${month} ${year}`), row());
    yearsInData.push(String(year));
  }
  const offsets = layout.map((_, i) => i * 50);

  // 253 month headers down to the scrubber's real cap.
  const ticks = buildTicks(layout, offsets, layout.length * 50, 120);

  const labelled = ticks.filter((t) => t.isYearStart).map((t) => yearOf(t.label));
  expect(labelled).toContain("2011");
  // Every year in the data, labelled exactly once — no year lost to the
  // cull, and none drawn twice.
  expect(labelled).toEqual(yearsInData);
});

// Whether a tick opens a year depends on the tick *before it that
// survived*, so the flags have to be re-derived after culling — otherwise
// two survivors of the same year both claim to open it and the track draws
// the year twice.
it("re-marks year starts against the surviving ticks, not the original ones", () => {
  const layout: LayoutItem[] = [];
  for (const year of [2020, 2019, 2020, 2019, 2020, 2019]) {
    layout.push(header(`June ${year}`), row());
  }
  const offsets = layout.map((_, i) => i * 50);

  const ticks = buildTicks(layout, offsets, layout.length * 50, 3);

  expect(ticks.map((t) => t.label)).toEqual(["June 2020", "June 2019", "June 2019"]);
  expect(ticks.map((t) => t.isYearStart)).toEqual([true, true, false]);
});

// A month inside the last screenful can never be scrolled to the top, so
// its tick belongs at the end of the track rather than past it.
it("clamps a tick past the end of the scrollable range to the bottom of the track", () => {
  const layout = [header("March 2019"), row(), header("February 2019"), row()];

  const ticks = buildTicks(layout, [0, 52, 900, 952], 500, 100);

  expect(ticks[1].offsetRatio).toBe(1);
});

describe("tileIndexAtOffset", () => {
  // The pill's date comes from a real photo, not from the month header the
  // year labels are built from — only the index knows individual dates.
  it("returns the first tile of the last row starting at or before the offset", () => {
    const layout = [header("March 2019"), row(0, 1), row(2, 3)];
    const offsets = [0, 52, 252];

    expect(tileIndexAtOffset(layout, offsets, 300)).toBe(2);
    expect(tileIndexAtOffset(layout, offsets, 100)).toBe(0);
  });

  // Landing on a header means the user has scrolled a new month to the top,
  // so the month they are arriving at is the answer — not the tail of the
  // one they just left.
  it("looks forward to the next row when the offset lands on a header", () => {
    const layout = [header("March 2019"), row(0), header("February 2019"), row(1)];
    const offsets = [0, 52, 252, 304];

    expect(tileIndexAtOffset(layout, offsets, 260)).toBe(1);
  });

  it("clamps an offset above the first row to the first tile", () => {
    const layout = [header("March 2019"), row(0)];

    expect(tileIndexAtOffset(layout, [0, 52], -20)).toBe(0);
  });

  it("returns null when the layout has no rows at all", () => {
    expect(tileIndexAtOffset([], [], 0)).toBeNull();
    expect(tileIndexAtOffset([header("March 2019")], [0], 0)).toBeNull();
  });
});

describe("yearOf", () => {
  it("takes the year off a month label", () => {
    expect(yearOf("March 2019")).toBe("2019");
  });

  it("leaves a label with no year part as itself", () => {
    expect(yearOf("Undated")).toBe("Undated");
  });
});
