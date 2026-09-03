import { describe, expect, it } from "vitest";
import { moveFocusRow } from "./rowNav";

describe("moveFocusRow", () => {
  const rows = [
    [0, 1, 2, 3],
    [4, 5, 6],
    [7, 8],
  ];

  it("moves down to the same column in the next row", () => {
    expect(moveFocusRow(rows, 1, 1)).toBe(5);
  });

  it("moves up to the same column in the previous row", () => {
    expect(moveFocusRow(rows, 5, -1)).toBe(1);
  });

  it("clamps to the last column when the target row is shorter", () => {
    expect(moveFocusRow(rows, 3, 1)).toBe(6);
    expect(moveFocusRow(rows, 6, 1)).toBe(8);
  });

  it("stays put when moving up from the first row", () => {
    expect(moveFocusRow(rows, 2, -1)).toBe(2);
  });

  it("stays put when moving down from the last row", () => {
    expect(moveFocusRow(rows, 8, 1)).toBe(8);
  });

  it("returns the index unchanged when it isn't found in any row", () => {
    expect(moveFocusRow(rows, 99, 1)).toBe(99);
    expect(moveFocusRow(rows, 99, -1)).toBe(99);
  });

  it("returns the index unchanged for an empty rows array", () => {
    expect(moveFocusRow([], 0, 1)).toBe(0);
  });

  it("skips an empty target row and stays put", () => {
    expect(moveFocusRow([[0, 1], [], [2, 3]], 0, 1)).toBe(0);
  });
});
