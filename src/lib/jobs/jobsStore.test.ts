import { beforeEach } from "vitest";
import type { JobEvent } from "@/lib/api/scan";
import { activeJobs, applyJobEvent, jobKindFromId, jobLabel, useJobsStore } from "./jobsStore";

beforeEach(() => {
  useJobsStore.setState({ events: {}, labels: {} });
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
});
