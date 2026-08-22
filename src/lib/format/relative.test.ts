import { formatRelative } from "./relative";

const now = new Date("2026-08-22T12:00:00Z").getTime();

describe("formatRelative", () => {
  it("shows 'just now' for anything under 60 seconds", () => {
    expect(formatRelative(new Date(now).toISOString(), now)).toBe("just now");
    expect(formatRelative(new Date(now - 45_000).toISOString(), now)).toBe("just now");
  });

  it("shows minutes for anything under an hour", () => {
    expect(formatRelative(new Date(now - 60_000).toISOString(), now)).toBe("1 min ago");
    expect(formatRelative(new Date(now - 2 * 60_000).toISOString(), now)).toBe("2 min ago");
    expect(formatRelative(new Date(now - 59 * 60_000).toISOString(), now)).toBe("59 min ago");
  });

  it("shows hours for anything under a day", () => {
    expect(formatRelative(new Date(now - 60 * 60_000).toISOString(), now)).toBe("1 hour ago");
    expect(formatRelative(new Date(now - 3 * 60 * 60_000).toISOString(), now)).toBe("3 hours ago");
  });

  it("shows days beyond a day", () => {
    expect(formatRelative(new Date(now - 24 * 60 * 60_000).toISOString(), now)).toBe("1 day ago");
    expect(formatRelative(new Date(now - 2 * 24 * 60 * 60_000).toISOString(), now)).toBe("2 days ago");
  });

  it("defaults now to Date.now() when not given", () => {
    expect(formatRelative(new Date().toISOString())).toBe("just now");
  });
});
