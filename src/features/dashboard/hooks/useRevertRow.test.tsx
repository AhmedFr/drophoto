import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import type { JobEvent } from "@/lib/api/scan";
import { useRevertRow } from "./useRevertRow";

beforeEach(() => {
  // `useRevertRow` reads job events from the global `jobsStore` (via
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

function renderRow() {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const view = renderHook(() => useRevertRow(), { wrapper: wrapperFor(queryClient) });
  return { ...view, invalidateSpy };
}

it("starts with no confirm dialog or revert in flight", async () => {
  await mockListen();
  const { result } = renderRow();
  expect(result.current.confirmJobId).toBeNull();
  expect(result.current.revertingJobId).toBeNull();
});

it("requestRevert opens the confirm dialog for that job id", async () => {
  await mockListen();
  const { result } = renderRow();
  act(() => result.current.requestRevert(7));
  expect(result.current.confirmJobId).toBe(7);
});

it("cancelRevert closes the dialog without calling revert_organize", async () => {
  const revertOrganizeSpy = vi.fn();
  mockIPC((cmd) => (cmd === "revert_organize" ? revertOrganizeSpy() : undefined));
  await mockListen();

  const { result } = renderRow();
  act(() => result.current.requestRevert(7));
  act(() => result.current.cancelRevert());

  expect(result.current.confirmJobId).toBeNull();
  expect(revertOrganizeSpy).not.toHaveBeenCalled();
});

it("confirmRevert calls revert_organize and tracks progress for that job", async () => {
  mockIPC((cmd) => (cmd === "revert_organize" ? "revert-1" : undefined));
  const { emit } = await mockListen();

  const { result } = renderRow();
  act(() => result.current.requestRevert(7));
  act(() => result.current.confirmRevert());

  await waitFor(() => expect(result.current.revertingJobId).toBe(7));
  expect(result.current.confirmJobId).toBeNull();

  emit({ kind: "progress", job_id: "revert-1", done: 1, total: 3, current: "a.jpg" });
  await waitFor(() => expect(result.current.revertProgress).toEqual({ done: 1, total: 3 }));
});

it("clears the in-flight state and invalidates queries once the revert finishes", async () => {
  mockIPC((cmd) => (cmd === "revert_organize" ? "revert-1" : undefined));
  const { emit } = await mockListen();

  const { result, invalidateSpy } = renderRow();
  act(() => result.current.requestRevert(7));
  act(() => result.current.confirmRevert());
  await waitFor(() => expect(result.current.revertingJobId).toBe(7));

  emit({ kind: "finished", job_id: "revert-1", ok: 3, failed: 0, skipped: 0 });

  await waitFor(() => expect(result.current.revertingJobId).toBeNull());
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["jobs"] });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["unorganized"] });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["media"] });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["media-count"] });
});

it("clears the in-flight state when the revert is cancelled", async () => {
  mockIPC((cmd) => (cmd === "revert_organize" ? "revert-1" : undefined));
  const { emit } = await mockListen();

  const { result } = renderRow();
  act(() => result.current.requestRevert(7));
  act(() => result.current.confirmRevert());
  await waitFor(() => expect(result.current.revertingJobId).toBe(7));

  emit({ kind: "cancelled", job_id: "revert-1", ok: 0, failed: 0, skipped: 0 });
  await waitFor(() => expect(result.current.revertingJobId).toBeNull());
});

it("surfaces a revert_organize call error on the job's row", async () => {
  mockIPC((cmd) => {
    if (cmd === "revert_organize") {
      throw { code: "Unsupported", message: "another job is running on this drive" };
    }
    return undefined;
  });
  await mockListen();

  const { result } = renderRow();
  act(() => result.current.requestRevert(7));
  act(() => result.current.confirmRevert());

  await waitFor(() =>
    expect(result.current.revertError).toEqual({
      jobId: 7,
      message: "another job is running on this drive",
    }),
  );
  expect(result.current.revertingJobId).toBeNull();
});

it("surfaces a partial-failure outcome as REVERT FAILED on the job's row, without blocking a retry", async () => {
  mockIPC((cmd) => (cmd === "revert_organize" ? "revert-1" : undefined));
  const { emit } = await mockListen();

  const { result } = renderRow();
  act(() => result.current.requestRevert(7));
  act(() => result.current.confirmRevert());
  await waitFor(() => expect(result.current.revertingJobId).toBe(7));

  emit({ kind: "finished", job_id: "revert-1", ok: 1, failed: 2, skipped: 0 });

  await waitFor(() =>
    expect(result.current.revertError).toEqual({
      jobId: 7,
      message: "REVERT FAILED — 2 files could not be moved back",
    }),
  );
  expect(result.current.revertingJobId).toBeNull();
});

it("uses singular file wording for a single failed item", async () => {
  mockIPC((cmd) => (cmd === "revert_organize" ? "revert-1" : undefined));
  const { emit } = await mockListen();

  const { result } = renderRow();
  act(() => result.current.requestRevert(7));
  act(() => result.current.confirmRevert());
  await waitFor(() => expect(result.current.revertingJobId).toBe(7));

  emit({ kind: "finished", job_id: "revert-1", ok: 0, failed: 1, skipped: 0 });

  await waitFor(() =>
    expect(result.current.revertError).toEqual({
      jobId: 7,
      message: "REVERT FAILED — 1 file could not be moved back",
    }),
  );
});

it("does not surface an error when the revert fully succeeds", async () => {
  mockIPC((cmd) => (cmd === "revert_organize" ? "revert-1" : undefined));
  const { emit } = await mockListen();

  const { result } = renderRow();
  act(() => result.current.requestRevert(7));
  act(() => result.current.confirmRevert());
  await waitFor(() => expect(result.current.revertingJobId).toBe(7));

  emit({ kind: "finished", job_id: "revert-1", ok: 3, failed: 0, skipped: 0 });
  await waitFor(() => expect(result.current.revertingJobId).toBeNull());

  expect(result.current.revertError).toBeNull();
});

it("clears a stale revertError once a fresh attempt is confirmed", async () => {
  const revertJobIds = ["revert-1", "revert-2"];
  let call = 0;
  mockIPC((cmd) => (cmd === "revert_organize" ? revertJobIds[call++] : undefined));
  const { emit } = await mockListen();

  const { result } = renderRow();
  act(() => result.current.requestRevert(7));
  act(() => result.current.confirmRevert());
  await waitFor(() => expect(result.current.revertingJobId).toBe(7));
  emit({ kind: "finished", job_id: "revert-1", ok: 0, failed: 1, skipped: 0 });
  await waitFor(() => expect(result.current.revertError?.jobId).toBe(7));

  act(() => result.current.requestRevert(7));
  act(() => result.current.confirmRevert());
  await waitFor(() => expect(result.current.revertError).toBeNull());
});
