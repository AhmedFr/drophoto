import { act, renderHook } from "@testing-library/react";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import { useJobEvents } from "./useJobEvents";

beforeEach(() => {
  useJobsStore.setState({ events: {}, labels: {} });
});

it("reflects the jobs store's events", () => {
  const { result } = renderHook(() => useJobEvents());
  expect(result.current).toEqual({});

  act(() => useJobsStore.getState().applyEvent({ kind: "started", job_id: "scan-0" }));
  expect(result.current["scan-0"]).toEqual({ kind: "started", job_id: "scan-0" });
});

it("tracks events for multiple jobs independently", () => {
  const { result } = renderHook(() => useJobEvents());

  act(() => {
    useJobsStore.getState().applyEvent({ kind: "started", job_id: "scan-0" });
    useJobsStore.getState().applyEvent({ kind: "started", job_id: "scan-1" });
  });

  expect(result.current["scan-0"]).toEqual({ kind: "started", job_id: "scan-0" });
  expect(result.current["scan-1"]).toEqual({ kind: "started", job_id: "scan-1" });
});

it("updates as the store's events change, e.g. progress -> finished", () => {
  const { result } = renderHook(() => useJobEvents());

  act(() =>
    useJobsStore.getState().applyEvent({ kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" }),
  );
  expect(result.current["scan-0"]).toMatchObject({ done: 3 });

  act(() => useJobsStore.getState().applyEvent({ kind: "finished", job_id: "scan-0", ok: 9, failed: 1, skipped: 0 }));
  expect(result.current["scan-0"]).toEqual({ kind: "finished", job_id: "scan-0", ok: 9, failed: 1, skipped: 0 });
});
