import { render, screen } from "@testing-library/react";
import type { Drive } from "@/lib/api/drives";
import type { JobRun } from "@/lib/api/metrics";
import { RunsCard, formatRunLine, runDurationMs, runRate } from "./RunsCard";

const drive: Drive = {
  id: 7,
  name: "Kodachrome",
  volume_uuid: null,
  volume_label: null,
  mount_path: "/Volumes/Kodachrome",
  role: "archive",
  capacity: 2_000_000_000,
  free: 1_500_000_000,
  last_seen_at: "2026-08-22T00:00:00Z",
  online: true,
};

function run(overrides: Partial<JobRun> = {}): JobRun {
  return {
    id: 1,
    job_id: "scan-3",
    kind: "scan",
    drive_id: 7,
    status: "done",
    ok: 100,
    failed: 0,
    skipped: 0,
    bytes_read: 0,
    bytes_written: 0,
    cpu_ms: 0,
    started_at: "2026-01-01T10:00:00Z",
    finished_at: "2026-01-01T10:01:00Z",
    ...overrides,
  };
}

describe("runDurationMs", () => {
  it("computes the gap between started_at and finished_at", () => {
    expect(runDurationMs(run({ started_at: "2026-01-01T10:00:00Z", finished_at: "2026-01-01T10:00:30Z" }))).toBe(
      30_000,
    );
  });

  it("clamps a negative gap to 0", () => {
    expect(runDurationMs(run({ started_at: "2026-01-01T10:01:00Z", finished_at: "2026-01-01T10:00:00Z" }))).toBe(0);
  });
});

describe("runRate", () => {
  it("computes files/sec over the run's duration", () => {
    const r = run({ ok: 60, skipped: 0, started_at: "2026-01-01T10:00:00Z", finished_at: "2026-01-01T10:00:10Z" });
    expect(runRate(r)).toBe(6);
  });

  it("returns null when the duration is zero", () => {
    const r = run({ started_at: "2026-01-01T10:00:00Z", finished_at: "2026-01-01T10:00:00Z" });
    expect(runRate(r)).toBeNull();
  });
});

describe("formatRunLine", () => {
  it("includes the file count, duration, and rate", () => {
    const r = run({
      ok: 60,
      skipped: 0,
      failed: 0,
      started_at: "2026-01-01T10:00:00Z",
      finished_at: "2026-01-01T10:00:10Z",
    });
    expect(formatRunLine(r)).toBe("60 files · 10s · 6.0/s");
  });

  it("flags failures inline", () => {
    const r = run({ ok: 5, skipped: 1, failed: 2 });
    expect(formatRunLine(r)).toContain("6 files (2 failed)");
  });

  it("includes bytes read when nonzero", () => {
    const r = run({ bytes_read: 2_000_000_000 });
    expect(formatRunLine(r)).toContain("1.9 GB read");
  });

  it("labels scan's bytes written as thumbs", () => {
    const r = run({ kind: "scan", bytes_written: 500_000 });
    expect(formatRunLine(r)).toContain("488 KB thumbs");
  });

  it("labels a non-scan kind's bytes written as written", () => {
    const r = run({ kind: "sidecar", bytes_written: 500 });
    expect(formatRunLine(r)).toContain("500 B written");
  });
});

describe("RunsCard", () => {
  it("shows an empty state when there are no runs", () => {
    render(<RunsCard runs={[]} drives={[]} />);
    expect(screen.getByText("No jobs have run yet.")).toBeInTheDocument();
  });

  it("renders a run's kind and resolved drive name", () => {
    render(<RunsCard runs={[run()]} drives={[drive]} />);
    expect(screen.getByText("SCAN Kodachrome")).toBeInTheDocument();
  });

  it("renders a global job's kind alone when drive_id is null", () => {
    render(<RunsCard runs={[run({ kind: "geocode", drive_id: null })]} drives={[drive]} />);
    expect(screen.getByText("GEOCODE")).toBeInTheDocument();
  });

  it("shows a status badge for a non-done run", () => {
    render(<RunsCard runs={[run({ status: "cancelled" })]} drives={[drive]} />);
    expect(screen.getByText("CANCELLED")).toBeInTheDocument();
  });

  it("shows no status badge for a done run", () => {
    render(<RunsCard runs={[run({ status: "done" })]} drives={[drive]} />);
    expect(screen.queryByText("DONE")).not.toBeInTheDocument();
  });

  it("only renders the most recent 8 runs", () => {
    const runs = Array.from({ length: 12 }, (_, i) => run({ id: i, job_id: `scan-${i}` }));
    render(<RunsCard runs={runs} drives={[drive]} />);
    expect(screen.getAllByText("SCAN Kodachrome")).toHaveLength(8);
  });
});
