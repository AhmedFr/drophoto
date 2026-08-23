import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import type { JobEvent } from "@/lib/api/scan";
import { useOrganizeRun } from "./useOrganizeRun";

beforeEach(() => {
  // `useOrganizeRun` reads job events from the global `jobsStore` (via
  // `useJobEvents`) rather than listening for the "job" Tauri event
  // itself — in the real app `JobEventsBridge` applies those events, so
  // tests seed the store directly instead of mocking `listen`.
  useJobsStore.setState({ events: {}, labels: {} });
});

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function mockListen() {
  return { emit: (payload: unknown) => act(() => useJobsStore.getState().applyEvent(payload as JobEvent)) };
}

function renderRun(driveIds: number[], driveNames?: Record<number, string>) {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const view = renderHook(() => useOrganizeRun(driveIds, driveNames), { wrapper: wrapperFor(queryClient) });
  return { ...view, invalidateSpy };
}

it("starts the first drive's job on start()", async () => {
  const startOrganize = vi.fn().mockResolvedValue("job-1");
  mockIPC((cmd) => (cmd === "start_organize" ? startOrganize() : undefined));
  await mockListen();

  const { result } = renderRun([1]);
  act(() => result.current.start());

  await waitFor(() => expect(result.current.running).toBe(true));
  await waitFor(() => expect(result.current.currentJobId).toBe("job-1"));
});

it("shows progress from the current job's progress event", async () => {
  mockIPC((cmd) => (cmd === "start_organize" ? "job-1" : undefined));
  const { emit } = await mockListen();

  const { result } = renderRun([1]);
  act(() => result.current.start());
  await waitFor(() => expect(result.current.currentJobId).toBe("job-1"));

  emit({ kind: "progress", job_id: "job-1", done: 3, total: 10, current: "a.jpg" });
  await waitFor(() => expect(result.current.progress).toEqual({ done: 3, total: 10 }));
});

it("starts the next drive's job only after the current one finishes", async () => {
  const jobIds = ["job-1", "job-2"];
  let call = 0;
  mockIPC((cmd) => (cmd === "start_organize" ? jobIds[call++] : undefined));
  const { emit } = await mockListen();

  const { result } = renderRun([1, 2]);
  act(() => result.current.start());
  await waitFor(() => expect(result.current.currentJobId).toBe("job-1"));

  emit({ kind: "finished", job_id: "job-1", ok: 5, failed: 0, skipped: 1 });
  await waitFor(() => expect(result.current.currentJobId).toBe("job-2"));
  expect(result.current.done).toBe(false);
  expect(result.current.running).toBe(true);

  emit({ kind: "finished", job_id: "job-2", ok: 2, failed: 1, skipped: 0 });
  await waitFor(() => expect(result.current.done).toBe(true));

  expect(result.current.running).toBe(false);
  expect(result.current.totals).toEqual({ moved: 7, skipped: 1, failed: 1 });
});

it("marks done and cancelled without incrementing totals when the job is cancelled", async () => {
  mockIPC((cmd) => (cmd === "start_organize" ? "job-1" : undefined));
  const { emit } = await mockListen();

  const { result } = renderRun([1]);
  act(() => result.current.start());
  await waitFor(() => expect(result.current.currentJobId).toBe("job-1"));

  emit({ kind: "cancelled", job_id: "job-1" });
  await waitFor(() => expect(result.current.done).toBe(true));
  expect(result.current.cancelled).toBe(true);
  expect(result.current.totals).toEqual({ moved: 0, skipped: 0, failed: 0 });
});

it("does not mark a normally-completed run as cancelled", async () => {
  mockIPC((cmd) => (cmd === "start_organize" ? "job-1" : undefined));
  const { emit } = await mockListen();

  const { result } = renderRun([1]);
  act(() => result.current.start());
  await waitFor(() => expect(result.current.currentJobId).toBe("job-1"));

  emit({ kind: "finished", job_id: "job-1", ok: 1, failed: 0, skipped: 0 });
  await waitFor(() => expect(result.current.done).toBe(true));
  expect(result.current.cancelled).toBe(false);
});

it("CANCEL during a multi-drive run stops the whole queue: the next drive is never started", async () => {
  const startOrganizeSpy = vi.fn().mockReturnValue("job-1");
  const cancelJobSpy = vi.fn();
  mockIPC((cmd) => {
    if (cmd === "start_organize") return startOrganizeSpy();
    if (cmd === "cancel_job") return cancelJobSpy();
    return undefined;
  });
  const { emit } = await mockListen();

  const { result } = renderRun([1, 2]);
  act(() => result.current.start());
  await waitFor(() => expect(result.current.currentJobId).toBe("job-1"));

  act(() => result.current.cancel());
  await waitFor(() => expect(cancelJobSpy).toHaveBeenCalled());

  // The runner reports `cancelled` for job-1 only after `cancel()` was called.
  emit({ kind: "cancelled", job_id: "job-1" });

  await waitFor(() => expect(result.current.done).toBe(true));
  expect(result.current.cancelled).toBe(true);
  expect(result.current.running).toBe(false);
  expect(startOrganizeSpy).toHaveBeenCalledTimes(1);
});

it("CANCEL stops the queue even if the in-flight job reports finished right after", async () => {
  const startOrganizeSpy = vi.fn().mockReturnValue("job-1");
  mockIPC((cmd) => (cmd === "start_organize" ? startOrganizeSpy() : undefined));
  const { emit } = await mockListen();

  const { result } = renderRun([1, 2]);
  act(() => result.current.start());
  await waitFor(() => expect(result.current.currentJobId).toBe("job-1"));

  act(() => result.current.cancel());
  // Race: the in-flight job happens to finish (not cancel) right after `cancel()`.
  emit({ kind: "finished", job_id: "job-1", ok: 3, failed: 0, skipped: 0 });

  await waitFor(() => expect(result.current.done).toBe(true));
  expect(result.current.cancelled).toBe(true);
  expect(startOrganizeSpy).toHaveBeenCalledTimes(1);
  expect(result.current.totals).toEqual({ moved: 3, skipped: 0, failed: 0 });
});

it("invalidates the plan query once every drive is done", async () => {
  mockIPC((cmd) => (cmd === "start_organize" ? "job-1" : undefined));
  const { emit } = await mockListen();

  const { result, invalidateSpy } = renderRun([1]);
  act(() => result.current.start());
  await waitFor(() => expect(result.current.currentJobId).toBe("job-1"));

  emit({ kind: "finished", job_id: "job-1", ok: 1, failed: 0, skipped: 0 });
  await waitFor(() => expect(result.current.done).toBe(true));

  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["plan", [1]] });
});

it("calls cancel_job with the current job id", async () => {
  const cancelJobSpy = vi.fn();
  mockIPC((cmd) => {
    if (cmd === "start_organize") return "job-1";
    if (cmd === "cancel_job") return cancelJobSpy();
  });
  await mockListen();

  const { result } = renderRun([1]);
  act(() => result.current.start());
  await waitFor(() => expect(result.current.currentJobId).toBe("job-1"));

  act(() => result.current.cancel());
  await waitFor(() => expect(cancelJobSpy).toHaveBeenCalled());
});

it("records the drive's name as the started job's label when driveNames is given", async () => {
  mockIPC((cmd) => (cmd === "start_organize" ? "job-1" : undefined));
  await mockListen();

  const { result } = renderRun([1], { 1: "Kodachrome" });
  act(() => result.current.start());

  await waitFor(() => expect(useJobsStore.getState().labels["job-1"]).toBe("Kodachrome"));
});

it("surfaces a start_organize error and stops running", async () => {
  mockIPC((cmd) => {
    if (cmd === "start_organize") {
      throw { code: "Unsupported", message: "a scan job is already running" };
    }
    return undefined;
  });
  await mockListen();

  const { result } = renderRun([1]);
  act(() => result.current.start());

  await waitFor(() => expect(result.current.error).toBe("a scan job is already running"));
  expect(result.current.running).toBe(false);
});
