import { beforeEach } from "vitest";
import type { JobEvent } from "@/lib/api/scan";
import type { Sample } from "./jobsStore.types";
import {
  activeJobs,
  applyJobEvent,
  applySample,
  etaSeconds,
  jobKindFromId,
  jobLabel,
  jobRate,
  useJobsStore,
} from "./jobsStore";

beforeEach(() => {
  useJobsStore.setState({ events: {}, labels: {}, samples: {}, driveIds: {} });
});

describe("applyJobEvent", () => {
  it("stores the latest event per job id", () => {
    let events = applyJobEvent({}, { kind: "started", job_id: "scan-0" });
    events = applyJobEvent(events, { kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" });
    expect(events["scan-0"]).toEqual({ kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" });
  });

  it("keeps the higher done count when progress events arrive out of order", () => {
    let events = applyJobEvent({}, { kind: "progress", job_id: "scan-0", done: 5, total: 10, current: "b.jpg" });
    events = applyJobEvent(events, { kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" });
    expect(events["scan-0"]).toMatchObject({ done: 5, current: "b.jpg" });
  });

  it("does not apply the out-of-order guard across different jobs", () => {
    let events = applyJobEvent({}, { kind: "progress", job_id: "scan-0", done: 5, total: 10, current: "b.jpg" });
    events = applyJobEvent(events, { kind: "progress", job_id: "scan-1", done: 1, total: 10, current: "a.jpg" });
    expect(events["scan-1"]).toMatchObject({ done: 1 });
  });

  it("overwrites a non-progress event unconditionally, e.g. a terminal event replacing progress", () => {
    let events = applyJobEvent({}, { kind: "progress", job_id: "scan-0", done: 5, total: 10, current: "b.jpg" });
    events = applyJobEvent(events, { kind: "finished", job_id: "scan-0", ok: 5, failed: 0, skipped: 0 });
    expect(events["scan-0"]).toEqual({ kind: "finished", job_id: "scan-0", ok: 5, failed: 0, skipped: 0 });
  });

  it("keeps a progress event's counts visible through an item_error, but a later progress or terminal event still supersedes", () => {
    let events = applyJobEvent(
      {},
      { kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" },
    );
    events = applyJobEvent(events, {
      kind: "item_error",
      job_id: "scan-0",
      path: "b.jpg",
      code: "io",
      message: "boom",
    });
    expect(events["scan-0"]).toEqual({ kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" });

    events = applyJobEvent(events, { kind: "progress", job_id: "scan-0", done: 4, total: 10, current: "c.jpg" });
    expect(events["scan-0"]).toEqual({ kind: "progress", job_id: "scan-0", done: 4, total: 10, current: "c.jpg" });

    events = applyJobEvent(events, { kind: "finished", job_id: "scan-0", ok: 4, failed: 1, skipped: 0 });
    expect(events["scan-0"]).toEqual({ kind: "finished", job_id: "scan-0", ok: 4, failed: 1, skipped: 0 });
  });

  it("keeps a started event through an item_error too", () => {
    let events = applyJobEvent({}, { kind: "started", job_id: "scan-0" });
    events = applyJobEvent(events, {
      kind: "item_error",
      job_id: "scan-0",
      path: "a.jpg",
      code: "io",
      message: "boom",
    });
    expect(events["scan-0"]).toEqual({ kind: "started", job_id: "scan-0" });
  });

  it("does not mutate the input events object", () => {
    const input: Record<string, JobEvent> = { "scan-0": { kind: "started", job_id: "scan-0" } };
    const result = applyJobEvent(input, { kind: "progress", job_id: "scan-0", done: 1, total: 5, current: null });
    expect(input["scan-0"]).toEqual({ kind: "started", job_id: "scan-0" });
    expect(result).not.toBe(input);
  });
});

describe("jobKindFromId", () => {
  it.each([
    ["scan-0", "Scan"],
    ["scan-12", "Scan"],
    ["organize-0", "Organize"],
    ["revert-3", "Revert"],
    ["sidecar-0", "Sidecar sync"],
    ["geocode-0", "Geocode"],
    ["regen-0", "Regenerate previews"],
    ["mystery-1", "Job"],
  ])("derives %s -> %s", (jobId, expected) => {
    expect(jobKindFromId(jobId)).toBe(expected);
  });
});

describe("jobLabel", () => {
  it("returns just the kind when no label is set", () => {
    expect(jobLabel("scan-0", {})).toBe("Scan");
  });

  it("appends the recorded label when one exists", () => {
    expect(jobLabel("scan-0", { "scan-0": "Kodachrome" })).toBe("Scan Kodachrome");
  });
});

describe("activeJobs", () => {
  it("includes jobs whose latest event is started or progress", () => {
    const state = {
      events: {
        "scan-0": { kind: "started", job_id: "scan-0" },
        "scan-1": { kind: "progress", job_id: "scan-1", done: 1, total: 10, current: "a.jpg" },
      } as Record<string, JobEvent>,
      labels: { "scan-1": "Kodachrome" },
    };
    const result = activeJobs(state);
    expect(result).toHaveLength(2);
    expect(result.find((j) => j.jobId === "scan-1")).toMatchObject({ label: "Scan Kodachrome" });
  });

  it("excludes jobs whose latest event is finished or cancelled", () => {
    const state = {
      events: {
        "scan-0": { kind: "finished", job_id: "scan-0", ok: 1, failed: 0, skipped: 0 },
        "scan-1": { kind: "cancelled", job_id: "scan-1", ok: 0, failed: 0, skipped: 0 },
      } as Record<string, JobEvent>,
      labels: {},
    };
    expect(activeJobs(state)).toEqual([]);
  });

  it("excludes item_error events (never the latest terminal-ish state to key off)", () => {
    const state = {
      events: { "scan-0": { kind: "item_error", job_id: "scan-0", path: "a.jpg", code: "io", message: "boom" } } as Record<
        string,
        JobEvent
      >,
      labels: {},
    };
    expect(activeJobs(state)).toEqual([]);
  });
});

describe("useJobsStore", () => {
  it("applyEvent updates events reactively", () => {
    useJobsStore.getState().applyEvent({ kind: "started", job_id: "scan-0" });
    expect(useJobsStore.getState().events["scan-0"]).toEqual({ kind: "started", job_id: "scan-0" });
  });

  it("setLabel records a label for a job id", () => {
    useJobsStore.getState().setLabel("scan-0", "Kodachrome");
    expect(useJobsStore.getState().labels["scan-0"]).toBe("Kodachrome");
  });

  it("clearFinished drops only terminal jobs", () => {
    useJobsStore.getState().applyEvent({ kind: "progress", job_id: "scan-0", done: 1, total: 10, current: "a" });
    useJobsStore.getState().applyEvent({ kind: "finished", job_id: "scan-1", ok: 1, failed: 0, skipped: 0 });
    useJobsStore.getState().clearFinished();
    const events = useJobsStore.getState().events;
    expect(events["scan-0"]).toBeDefined();
    expect(events["scan-1"]).toBeUndefined();
  });

  it("applyEvent maintains samples for progress events", () => {
    useJobsStore.getState().applyEvent({ kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a" });
    expect(useJobsStore.getState().samples["scan-0"]).toHaveLength(1);
  });

  it("applyEvent clears samples on a terminal event", () => {
    useJobsStore.getState().applyEvent({ kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a" });
    useJobsStore.getState().applyEvent({ kind: "finished", job_id: "scan-0", ok: 3, failed: 0, skipped: 0 });
    expect(useJobsStore.getState().samples["scan-0"]).toBeUndefined();
  });

  it("setJobDrive records a drive id for a job id", () => {
    useJobsStore.getState().setJobDrive("scan-0", 3);
    expect(useJobsStore.getState().driveIds["scan-0"]).toBe(3);
  });

  it("clearFinished also drops driveIds entries for terminal jobs", () => {
    useJobsStore.getState().setJobDrive("scan-0", 1);
    useJobsStore.getState().setJobDrive("scan-1", 2);
    useJobsStore.getState().applyEvent({ kind: "progress", job_id: "scan-0", done: 1, total: 10, current: "a" });
    useJobsStore.getState().applyEvent({ kind: "finished", job_id: "scan-1", ok: 1, failed: 0, skipped: 0 });
    useJobsStore.getState().clearFinished();
    const driveIds = useJobsStore.getState().driveIds;
    expect(driveIds["scan-0"]).toBe(1);
    expect(driveIds["scan-1"]).toBeUndefined();
  });
});

describe("applySample", () => {
  it("appends a sample for a progress event", () => {
    const samples = applySample({}, { kind: "progress", job_id: "scan-0", done: 5, total: 10, current: "a" }, 1000);
    expect(samples["scan-0"]).toEqual([{ t: 1000, done: 5 }]);
  });

  it("prunes samples older than the 30s window before appending", () => {
    const existing: Record<string, Sample[]> = {
      "scan-0": [
        { t: 0, done: 1 },
        { t: 10_000, done: 2 },
      ],
    };
    const samples = applySample(
      existing,
      { kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a" },
      35_000,
    );
    // The window is [35_000 - 30_000, 35_000] = [5_000, 35_000]: t: 0 falls
    // outside it and is dropped, t: 10_000 is still inside and survives.
    expect(samples["scan-0"]).toEqual([
      { t: 10_000, done: 2 },
      { t: 35_000, done: 3 },
    ]);
  });

  it("caps samples at 60 entries", () => {
    const existing: Record<string, Sample[]> = {
      "scan-0": Array.from({ length: 60 }, (_, i) => ({ t: i * 100, done: i })),
    };
    const samples = applySample(
      existing,
      { kind: "progress", job_id: "scan-0", done: 999, total: 1000, current: "a" },
      6000,
    );
    expect(samples["scan-0"]).toHaveLength(60);
    expect(samples["scan-0"][59]).toEqual({ t: 6000, done: 999 });
  });

  it("deletes a job's samples on a terminal event", () => {
    const existing: Record<string, Sample[]> = { "scan-0": [{ t: 0, done: 1 }] };
    const samples = applySample(
      existing,
      { kind: "finished", job_id: "scan-0", ok: 1, failed: 0, skipped: 0 },
      1000,
    );
    expect(samples["scan-0"]).toBeUndefined();
  });

  it("leaves samples unchanged for a started or item_error event", () => {
    const existing: Record<string, Sample[]> = { "scan-0": [{ t: 0, done: 1 }] };
    expect(applySample(existing, { kind: "started", job_id: "scan-0" }, 1000)).toBe(existing);
    expect(
      applySample(
        existing,
        { kind: "item_error", job_id: "scan-0", path: "a.jpg", code: "io", message: "boom" },
        1000,
      ),
    ).toBe(existing);
  });
});

describe("jobRate", () => {
  it("returns null with fewer than 2 samples", () => {
    expect(jobRate([], 1000)).toBeNull();
    expect(jobRate([{ t: 0, done: 1 }], 1000)).toBeNull();
  });

  it("computes files/sec from the oldest to newest sample in the window", () => {
    const samples: Sample[] = [
      { t: 0, done: 0 },
      { t: 5000, done: 10 },
      { t: 10_000, done: 20 },
    ];
    expect(jobRate(samples, 10_000)).toBe(2);
  });

  it("ignores samples older than the 30s window", () => {
    const samples: Sample[] = [
      { t: 0, done: 0 },
      { t: 40_000, done: 100 },
      { t: 41_000, done: 102 },
    ];
    // Only the last two fall in [11_000, 41_000]; delta 2 over 1s = 2/s.
    expect(jobRate(samples, 41_000)).toBe(2);
  });

  it("returns null when elapsed time is non-positive", () => {
    const samples: Sample[] = [
      { t: 1000, done: 1 },
      { t: 1000, done: 2 },
    ];
    expect(jobRate(samples, 1000)).toBeNull();
  });
});

describe("etaSeconds", () => {
  it("returns null when rate is null", () => {
    expect(etaSeconds(null, 5, 10)).toBeNull();
  });

  it("returns null when rate is non-positive", () => {
    expect(etaSeconds(0, 5, 10)).toBeNull();
  });

  it("returns null when total is 0 (no total reported yet)", () => {
    expect(etaSeconds(2, 5, 0)).toBeNull();
  });

  it("computes remaining seconds at the given rate", () => {
    expect(etaSeconds(2, 5, 10)).toBe(2.5);
  });

  it("returns 0 once done has reached total", () => {
    expect(etaSeconds(2, 10, 10)).toBe(0);
    expect(etaSeconds(2, 12, 10)).toBe(0);
  });
});
