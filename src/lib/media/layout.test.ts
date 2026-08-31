import { describe, expect, it } from "vitest";
import type { MediaItem } from "@/lib/api/media";
import { buildLayout, GAP, HEADER_HEIGHT, type LayoutItem } from "./layout";

let nextId = 1;

function makeItem(width: number | null, height: number | null, takenAt: string | null): MediaItem {
  const id = nextId++;
  return {
    row: {
      id,
      drive_id: 1,
      rel_path: `photo-${id}.jpg`,
      hash: `hash-${id}`,
      size: 1024,
      kind: "photo",
      ext: "jpg",
      width,
      height,
      duration_ms: null,
      taken_at: takenAt,
      camera: null,
      lens: null,
      aperture: null,
      shutter: null,
      iso: null,
      focal_mm: null,
      lat: null,
      lon: null,
      missing_at: null,
      organized_at: null,
      source_id: null,
      place_id: null,
      mtime: null,
    },
    thumb_path: `thumb-${id}.jpg`,
    preview_path: `preview-${id}.jpg`,
    drive_name: "Drive",
    online: true,
    original_path: null,
    has_thumb: true,
  };
}

function rowsOf(layout: LayoutItem[]): Extract<LayoutItem, { kind: "row" }>[] {
  return layout.filter((l): l is Extract<LayoutItem, { kind: "row" }> => l.kind === "row");
}

function headersOf(layout: LayoutItem[]): Extract<LayoutItem, { kind: "header" }>[] {
  return layout.filter((l): l is Extract<LayoutItem, { kind: "header" }> => l.kind === "header");
}

describe("buildLayout", () => {
  it("returns an empty layout for no items", () => {
    expect(buildLayout([], 1000, 240)).toEqual([]);
  });

  it("returns an empty layout when containerWidth is not positive", () => {
    const items = [makeItem(100, 100, "2025-09-01T00:00:00Z")];
    expect(buildLayout(items, 0, 240)).toEqual([]);
    expect(buildLayout(items, -10, 240)).toEqual([]);
  });

  it("closes a row once a tile tips the accumulated width over the container width", () => {
    // 5 square (1:1) items at target 240 in a 1000px container tip over on the 5th tile:
    // sum(ratio)=5, 5*240 + GAP*4 = 1232 >= 1000, so the row closes including that 5th tile.
    const items = Array.from({ length: 5 }, () => makeItem(100, 100, "2025-09-01T00:00:00Z"));
    const layout = buildLayout(items, 1000, 240);
    const rows = rowsOf(layout);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.tiles).toHaveLength(5);
    const widthSum = row.tiles.reduce((sum, t) => sum + t.width, 0);
    expect(widthSum + GAP * 4).toBeCloseTo(1000, 0);
    // all tiles have equal ratio so they get equal widths
    for (const t of row.tiles) expect(t.width).toBeCloseTo(row.tiles[0].width, 1);
    expect(row.height).toBeCloseTo((1000 - GAP * 4) / 5, 1);
  });

  it("keeps a trailing row that never tips over at the target height, unscaled", () => {
    const items = Array.from({ length: 3 }, () => makeItem(100, 100, "2025-09-01T00:00:00Z"));
    const layout = buildLayout(items, 1000, 240);
    const rows = rowsOf(layout);
    expect(rows).toHaveLength(1);
    expect(rows[0].height).toBe(240);
    for (const t of rows[0].tiles) expect(t.width).toBeCloseTo(240, 5);
  });

  it("packs many items into multiple rows, each full row filling the container within 1px", () => {
    // 10 full-tip rows of 5 + 2 leftover items forming a trailing partial row.
    const items = Array.from({ length: 12 }, () => makeItem(100, 100, "2025-09-01T00:00:00Z"));
    const layout = buildLayout(items, 1000, 240);
    const rows = rowsOf(layout);
    expect(rows).toHaveLength(3);
    for (const row of rows.slice(0, 2)) {
      const widthSum = row.tiles.reduce((sum, t) => sum + t.width, 0);
      expect(Math.abs(widthSum + GAP * (row.tiles.length - 1) - 1000)).toBeLessThanOrEqual(1);
    }
    const last = rows[2];
    expect(last.tiles).toHaveLength(2);
    expect(last.height).toBe(240);
  });

  it("groups consecutive items by month, emitting a header with label and count per group", () => {
    const items = [
      makeItem(100, 100, "2025-09-01T00:00:00Z"),
      makeItem(100, 100, "2025-09-15T00:00:00Z"),
      makeItem(100, 100, "2025-08-01T00:00:00Z"),
    ];
    const layout = buildLayout(items, 1000, 240);
    const headers = headersOf(layout);
    expect(headers).toHaveLength(2);
    expect(headers[0]).toMatchObject({ label: "September 2025", count: 2, height: HEADER_HEIGHT });
    expect(headers[1]).toMatchObject({ label: "August 2025", count: 1, height: HEADER_HEIGHT });
  });

  it("labels an undated group as Undated", () => {
    const items = [makeItem(100, 100, null), makeItem(100, 100, null)];
    const layout = buildLayout(items, 1000, 240);
    const headers = headersOf(layout);
    expect(headers).toHaveLength(1);
    expect(headers[0]).toMatchObject({ label: "Undated", count: 2, key: "h:undated:0" });
  });

  it("keeps tile index continuous across rows and groups, matching position in the flat items array", () => {
    const items = [
      ...Array.from({ length: 5 }, () => makeItem(100, 100, "2025-09-01T00:00:00Z")),
      ...Array.from({ length: 3 }, () => makeItem(100, 100, "2025-08-01T00:00:00Z")),
    ];
    const layout = buildLayout(items, 1000, 240);
    const indexes = rowsOf(layout).flatMap((r) => r.tiles.map((t) => t.index));
    expect(indexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("clamps an extreme ratio to the 4/3 → [0.3, 4] range", () => {
    const wide = makeItem(1000, 100, "2025-09-01T00:00:00Z"); // ratio 10 -> clamped to 4
    const layoutWide = buildLayout([wide], 1000, 100);
    expect(layoutWide.find((l) => l.kind === "row" && l.tiles[0])).toBeDefined();
    const wideRow = rowsOf(layoutWide)[0];
    expect(wideRow.tiles[0].width).toBeCloseTo(4 * 100, 5);

    const tall = makeItem(30, 1000, "2025-09-01T00:00:00Z"); // ratio 0.03 -> clamped to 0.3
    const layoutTall = buildLayout([tall], 1000, 100);
    const tallRow = rowsOf(layoutTall)[0];
    expect(tallRow.tiles[0].width).toBeCloseTo(0.3 * 100, 5);
  });

  it("treats items with missing width/height as 4:3", () => {
    const item = makeItem(null, null, "2025-09-01T00:00:00Z");
    const layout = buildLayout([item], 1000, 240);
    const row = rowsOf(layout)[0];
    expect(row.tiles[0].width).toBeCloseTo((4 / 3) * 240, 5);
  });

  it("gives every LayoutItem a positionally unique key when a month recurs non-consecutively", () => {
    // An ADDED sort can interleave months out of chronological order, so the
    // same `monthKey` ("2025-09") can appear in two separate, non-adjacent
    // groups — the keys must still be distinct.
    const items = [
      makeItem(100, 100, "2025-09-01T00:00:00Z"),
      makeItem(100, 100, "2025-08-01T00:00:00Z"),
      makeItem(100, 100, "2025-09-15T00:00:00Z"),
    ];
    const layout = buildLayout(items, 1000, 240);
    const keys = new Set(layout.map((l) => l.key));
    expect(keys.size).toBe(layout.length);
  });
});
