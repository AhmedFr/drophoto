import { formatBytes } from "./bytes";

describe("formatBytes", () => {
  it("formats bytes, KB, MB, GB, TB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(17.4 * 1024 ** 2)).toBe("17.4 MB");
    expect(formatBytes(2 * 1024 ** 4)).toBe("2 TB");
  });
});
