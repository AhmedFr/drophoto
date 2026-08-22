import { describe, expect, it } from "vitest";
import {
  formatCoords,
  formatDims,
  formatDuration,
  formatExposure,
  formatIsoFocal,
  formatTakenAt,
  monthKey,
  monthLabel,
} from "./format";

describe("monthLabel", () => {
  it("formats a UTC month and year", () => {
    expect(monthLabel("2025-09-12T14:03:00Z")).toBe("September 2025");
  });

  it("returns Undated for null", () => {
    expect(monthLabel(null)).toBe("Undated");
  });
});

describe("monthKey", () => {
  it("formats YYYY-MM in UTC", () => {
    expect(monthKey("2025-09-12T14:03:00Z")).toBe("2025-09");
  });

  it("pads single-digit months", () => {
    expect(monthKey("2025-01-05T00:00:00Z")).toBe("2025-01");
  });

  it("returns undated for null", () => {
    expect(monthKey(null)).toBe("undated");
  });
});

describe("formatDuration", () => {
  it("formats seconds under a minute", () => {
    expect(formatDuration(42000)).toBe("0:42");
  });

  it("formats minutes and seconds, zero-padded", () => {
    expect(formatDuration(75000)).toBe("1:15");
  });

  it("returns empty string for null", () => {
    expect(formatDuration(null)).toBe("");
  });
});

describe("formatExposure", () => {
  it("formats aperture and a fast fractional shutter speed", () => {
    expect(formatExposure(2, 0.00125)).toBe("ƒ/2.0 · 1/800s");
  });

  it("formats aperture and a whole-second shutter speed", () => {
    expect(formatExposure(8, 2)).toBe("ƒ/8.0 · 2s");
  });

  it("formats one-decimal apertures like 1.8", () => {
    expect(formatExposure(1.8, 0.004)).toBe("ƒ/1.8 · 1/250s");
  });

  it("uses — for a missing aperture", () => {
    expect(formatExposure(null, 0.001)).toBe("— · 1/1000s");
  });

  it("uses — for a missing shutter", () => {
    expect(formatExposure(2, null)).toBe("ƒ/2.0 · —");
  });

  it("returns — when both are missing", () => {
    expect(formatExposure(null, null)).toBe("—");
  });
});

describe("formatIsoFocal", () => {
  it("joins iso and focal length", () => {
    expect(formatIsoFocal(100, 35)).toBe("100 · 35mm");
  });

  it("returns — when both are missing", () => {
    expect(formatIsoFocal(null, null)).toBe("—");
  });

  it("uses — for a missing iso", () => {
    expect(formatIsoFocal(null, 50)).toBe("— · 50mm");
  });

  it("uses — for a missing focal length", () => {
    expect(formatIsoFocal(400, null)).toBe("400 · —");
  });
});

describe("formatCoords", () => {
  it("formats northern/western coordinates to 2 decimals", () => {
    expect(formatCoords(38.71, -9.13)).toBe("38.71°N 9.13°W");
  });

  it("formats southern/eastern coordinates", () => {
    expect(formatCoords(-33.87, 151.21)).toBe("33.87°S 151.21°E");
  });

  it("returns empty string when lat is null", () => {
    expect(formatCoords(null, 10)).toBe("");
  });

  it("returns empty string when lon is null", () => {
    expect(formatCoords(10, null)).toBe("");
  });

  it("returns empty string when both are null", () => {
    expect(formatCoords(null, null)).toBe("");
  });
});

describe("formatTakenAt", () => {
  it("formats a UTC date and time", () => {
    expect(formatTakenAt("2025-09-12T14:03:00Z")).toBe("12 Sep 2025 · 14:03");
  });

  it("zero-pads hours and minutes", () => {
    expect(formatTakenAt("2025-01-05T04:07:00Z")).toBe("5 Jan 2025 · 04:07");
  });

  it("returns Unknown for null", () => {
    expect(formatTakenAt(null)).toBe("Unknown");
  });
});

describe("formatDims", () => {
  it("joins width and height with a multiplication sign", () => {
    expect(formatDims(6000, 4000)).toBe("6000 × 4000");
  });

  it("returns — when width is missing", () => {
    expect(formatDims(null, 4000)).toBe("—");
  });

  it("returns — when height is missing", () => {
    expect(formatDims(6000, null)).toBe("—");
  });

  it("returns — when both are missing", () => {
    expect(formatDims(null, null)).toBe("—");
  });
});
