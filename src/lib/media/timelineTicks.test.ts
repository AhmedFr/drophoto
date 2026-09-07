import type { LayoutItem } from "./layout";
import { buildTicks, tileIndexAtOffset } from "./timelineTicks";

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

describe("tileIndexAtOffset", () => {
  // The pill's date comes from a real photo, not from the month header the
  // year labels are built from — only the index knows individual dates.
  it("returns the first tile of the last row at or above the offset", () => {
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
