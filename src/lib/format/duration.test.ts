import { formatDurationShort } from "./duration";

describe("formatDurationShort", () => {
  it.each([
    [12_000, "12s"],
    [59_000, "59s"],
    [192_000, "3m 12s"],
    [180_000, "3m"],
    [41 * 60_000, "41m"],
    [10 * 60_000, "10m"],
    [3600_000 + 20 * 60_000, "1h 20m"],
  ])("formats %ims as %s", (ms, expected) => {
    expect(formatDurationShort(ms)).toBe(expected);
  });
});
