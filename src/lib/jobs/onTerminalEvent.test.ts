import { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";
import { toast } from "sonner";
import { onTerminalEvent } from "./onTerminalEvent";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

beforeEach(() => {
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

function client() {
  const queryClient = new QueryClient();
  return { queryClient, invalidateSpy: vi.spyOn(queryClient, "invalidateQueries") };
}

it("is a no-op for started, progress, and item_error events", () => {
  const { queryClient, invalidateSpy } = client();
  onTerminalEvent({ kind: "started", job_id: "scan-0" }, queryClient, "Scan");
  onTerminalEvent(
    { kind: "progress", job_id: "scan-0", done: 1, total: 10, current: "a.jpg" },
    queryClient,
    "Scan",
  );
  onTerminalEvent(
    { kind: "item_error", job_id: "scan-0", path: "a.jpg", code: "io", message: "boom" },
    queryClient,
    "Scan",
  );

  expect(invalidateSpy).not.toHaveBeenCalled();
  expect(toast).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it("invalidates media, media-count, jobs, unorganized, and drives on finished", () => {
  const { queryClient, invalidateSpy } = client();
  onTerminalEvent({ kind: "finished", job_id: "scan-0", ok: 9, failed: 0, skipped: 1 }, queryClient, "Scan");

  for (const key of ["media", "media-count", "jobs", "unorganized", "drives"]) {
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
  }
});

it("invalidates the same queries on cancelled", () => {
  const { queryClient, invalidateSpy } = client();
  onTerminalEvent({ kind: "cancelled", job_id: "scan-0", ok: 0, failed: 0, skipped: 0 }, queryClient, "Scan");

  for (const key of ["media", "media-count", "jobs", "unorganized", "drives"]) {
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
  }
});

it("shows a success toast with ok+skipped tallies when finished with no failures", () => {
  const { queryClient } = client();
  onTerminalEvent(
    { kind: "finished", job_id: "scan-0", ok: 9, failed: 0, skipped: 1 },
    queryClient,
    "Scan Kodachrome",
  );

  expect(toast.success).toHaveBeenCalledWith("Scan Kodachrome finished — 10 files");
});

it("uses singular 'file' for a single-file finish", () => {
  const { queryClient } = client();
  onTerminalEvent({ kind: "finished", job_id: "scan-0", ok: 1, failed: 0, skipped: 0 }, queryClient, "Scan");

  expect(toast.success).toHaveBeenCalledWith("Scan finished — 1 file");
});

it("shows an error toast with the failure count when finished with failures", () => {
  const { queryClient } = client();
  onTerminalEvent(
    { kind: "finished", job_id: "scan-0", ok: 8, failed: 2, skipped: 0 },
    queryClient,
    "Scan Kodachrome",
  );

  expect(toast.error).toHaveBeenCalledWith("Scan Kodachrome finished with 2 errors");
});

it("uses singular 'error' for a single failure", () => {
  const { queryClient } = client();
  onTerminalEvent({ kind: "finished", job_id: "scan-0", ok: 8, failed: 1, skipped: 0 }, queryClient, "Scan");

  expect(toast.error).toHaveBeenCalledWith("Scan finished with 1 error");
});

it("shows a neutral toast with the ok tally on cancelled", () => {
  const { queryClient } = client();
  onTerminalEvent(
    { kind: "cancelled", job_id: "scan-0", ok: 4, failed: 0, skipped: 0 },
    queryClient,
    "Organize Kodachrome",
  );

  expect(toast).toHaveBeenCalledWith("Organize Kodachrome cancelled — 4 files done");
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it("uses singular 'file' when cancelled after exactly one file", () => {
  const { queryClient } = client();
  onTerminalEvent({ kind: "cancelled", job_id: "scan-0", ok: 1, failed: 0, skipped: 0 }, queryClient, "Scan");

  expect(toast).toHaveBeenCalledWith("Scan cancelled — 1 file done");
});

it("is silent and refreshes only the tag queries for a clean sidecar sync", () => {
  const { queryClient, invalidateSpy } = client();
  onTerminalEvent(
    { kind: "finished", job_id: "sidecar-0", ok: 3, failed: 0, skipped: 0 },
    queryClient,
    "Sidecar sync",
  );

  expect(invalidateSpy.mock.calls.map((c) => c[0]?.queryKey)).toEqual([["tags"], ["media-tags"]]);
  expect(toast).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it("refreshes only the tag queries for a cancelled sidecar sync", () => {
  const { queryClient, invalidateSpy } = client();
  onTerminalEvent(
    { kind: "cancelled", job_id: "sidecar-0", ok: 1, failed: 0, skipped: 0 },
    queryClient,
    "Sidecar sync",
  );

  expect(invalidateSpy.mock.calls.map((c) => c[0]?.queryKey)).toEqual([["tags"], ["media-tags"]]);
  expect(toast).not.toHaveBeenCalled();
});

it("still shows an error toast for a sidecar sync that finishes with failures", () => {
  const { queryClient } = client();
  onTerminalEvent(
    { kind: "finished", job_id: "sidecar-0", ok: 1, failed: 2, skipped: 0 },
    queryClient,
    "Sidecar sync",
  );

  expect(toast.error).toHaveBeenCalledWith("Sidecar sync finished with 2 errors");
});

it("refreshes only the tag queries even when a sidecar sync fails", () => {
  const { queryClient, invalidateSpy } = client();
  onTerminalEvent(
    { kind: "finished", job_id: "sidecar-0", ok: 1, failed: 2, skipped: 0 },
    queryClient,
    "Sidecar sync",
  );

  expect(invalidateSpy.mock.calls.map((c) => c[0]?.queryKey)).toEqual([["tags"], ["media-tags"]]);
});
