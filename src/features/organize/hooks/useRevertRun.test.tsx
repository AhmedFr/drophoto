import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { useRevertRun } from "./useRevertRun";

vi.mock("@tauri-apps/api/event");

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

async function mockListen() {
  const { listen } = await import("@tauri-apps/api/event");
  let handler: ((event: { payload: unknown }) => void) | undefined;
  vi.mocked(listen).mockImplementation((_name, cb) => {
    handler = cb as (event: { payload: unknown }) => void;
    return Promise.resolve(vi.fn());
  });
  return { emit: (payload: unknown) => act(() => handler?.({ payload })) };
}

function renderRun(jobIds: number[]) {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const view = renderHook(() => useRevertRun(jobIds), { wrapper: wrapperFor(queryClient) });
  return { ...view, invalidateSpy };
}

it("reverts the first job id on start()", async () => {
  const revertOrganizeSpy = vi.fn().mockResolvedValue("revert-1");
  mockIPC((cmd) => (cmd === "revert_organize" ? revertOrganizeSpy() : undefined));
  await mockListen();

  const { result } = renderRun([1]);
  act(() => result.current.start());

  await waitFor(() => expect(result.current.running).toBe(true));
  await waitFor(() => expect(revertOrganizeSpy).toHaveBeenCalledTimes(1));
});

it("shows progress from the current revert job's progress event", async () => {
  mockIPC((cmd) => (cmd === "revert_organize" ? "revert-1" : undefined));
  const { emit } = await mockListen();

  const { result } = renderRun([1]);
  act(() => result.current.start());

  emit({ kind: "progress", job_id: "revert-1", done: 2, total: 5, current: "a.jpg" });
  await waitFor(() => expect(result.current.progress).toEqual({ done: 2, total: 5 }));
});

it("reverts each job id in sequence, only starting the next once the current one finishes", async () => {
  const revertJobIds = ["revert-1", "revert-2"];
  let call = 0;
  const revertOrganizeSpy = vi.fn(() => revertJobIds[call++]);
  mockIPC((cmd) => (cmd === "revert_organize" ? revertOrganizeSpy() : undefined));
  const { emit } = await mockListen();

  const { result } = renderRun([10, 20]);
  act(() => result.current.start());
  await waitFor(() => expect(revertOrganizeSpy).toHaveBeenCalledTimes(1));

  emit({ kind: "finished", job_id: "revert-1", ok: 1, failed: 0, skipped: 0 });
  await waitFor(() => expect(revertOrganizeSpy).toHaveBeenCalledTimes(2));
  expect(result.current.done).toBe(false);
  expect(result.current.running).toBe(true);

  emit({ kind: "finished", job_id: "revert-2", ok: 1, failed: 0, skipped: 0 });
  await waitFor(() => expect(result.current.done).toBe(true));
  expect(result.current.running).toBe(false);
});

it("invalidates jobs/unorganized/media/media-count once every job id is done", async () => {
  mockIPC((cmd) => (cmd === "revert_organize" ? "revert-1" : undefined));
  const { emit } = await mockListen();

  const { result, invalidateSpy } = renderRun([1]);
  act(() => result.current.start());
  await waitFor(() => expect(result.current.running).toBe(true));

  emit({ kind: "finished", job_id: "revert-1", ok: 1, failed: 0, skipped: 0 });
  await waitFor(() => expect(result.current.done).toBe(true));

  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["jobs"] });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["unorganized"] });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["media"] });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["media-count"] });
});

it("marks done when a revert job is cancelled", async () => {
  mockIPC((cmd) => (cmd === "revert_organize" ? "revert-1" : undefined));
  const { emit } = await mockListen();

  const { result } = renderRun([1]);
  act(() => result.current.start());
  await waitFor(() => expect(result.current.running).toBe(true));

  emit({ kind: "cancelled", job_id: "revert-1" });
  await waitFor(() => expect(result.current.done).toBe(true));
  expect(result.current.running).toBe(false);
});

it("accumulates failed items across the whole sequence", async () => {
  const revertJobIds = ["revert-1", "revert-2"];
  let call = 0;
  mockIPC((cmd) => (cmd === "revert_organize" ? revertJobIds[call++] : undefined));
  const { emit } = await mockListen();

  const { result } = renderRun([10, 20]);
  act(() => result.current.start());
  await waitFor(() => expect(result.current.running).toBe(true));

  emit({ kind: "finished", job_id: "revert-1", ok: 0, failed: 2, skipped: 0 });
  await waitFor(() => expect(call).toBe(2));

  emit({ kind: "finished", job_id: "revert-2", ok: 3, failed: 1, skipped: 0 });
  await waitFor(() => expect(result.current.done).toBe(true));

  expect(result.current.failed).toBe(3);
});

it("reports failed as zero once every job id fully reverted", async () => {
  mockIPC((cmd) => (cmd === "revert_organize" ? "revert-1" : undefined));
  const { emit } = await mockListen();

  const { result } = renderRun([1]);
  act(() => result.current.start());
  await waitFor(() => expect(result.current.running).toBe(true));

  emit({ kind: "finished", job_id: "revert-1", ok: 5, failed: 0, skipped: 0 });
  await waitFor(() => expect(result.current.done).toBe(true));

  expect(result.current.failed).toBe(0);
});

it("resets failed to zero on a fresh start()", async () => {
  // Two distinct job ids across the two runs — a real `revert_organize`
  // call always returns a fresh, runner-scoped id, so this is the
  // realistic case (as opposed to a stale terminal event for a reused
  // id "sticking around" in `useJobEvents`, which is an artifact of the
  // mock rather than something that happens for real).
  const revertJobIds = ["revert-1", "revert-2"];
  let call = 0;
  mockIPC((cmd) => (cmd === "revert_organize" ? revertJobIds[call++] : undefined));
  const { emit } = await mockListen();

  const { result } = renderRun([1]);
  act(() => result.current.start());
  await waitFor(() => expect(result.current.running).toBe(true));
  emit({ kind: "finished", job_id: "revert-1", ok: 0, failed: 2, skipped: 0 });
  await waitFor(() => expect(result.current.failed).toBe(2));

  act(() => result.current.start());
  await waitFor(() => expect(result.current.failed).toBe(0));
});

it("does nothing when jobIds is empty", async () => {
  const revertOrganizeSpy = vi.fn();
  mockIPC((cmd) => (cmd === "revert_organize" ? revertOrganizeSpy() : undefined));
  await mockListen();

  const { result } = renderRun([]);
  act(() => result.current.start());

  expect(result.current.running).toBe(false);
  expect(revertOrganizeSpy).not.toHaveBeenCalled();
});

it("surfaces a revert_organize error and stops running", async () => {
  mockIPC((cmd) => {
    if (cmd === "revert_organize") {
      throw { code: "Unsupported", message: "the job is still running" };
    }
    return undefined;
  });
  await mockListen();

  const { result } = renderRun([1]);
  act(() => result.current.start());

  await waitFor(() => expect(result.current.error).toBe("the job is still running"));
  expect(result.current.running).toBe(false);
});
