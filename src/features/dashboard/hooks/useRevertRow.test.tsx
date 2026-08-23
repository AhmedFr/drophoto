import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { useRevertRow } from "./useRevertRow";

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

  emit({ kind: "cancelled", job_id: "revert-1" });
  await waitFor(() => expect(result.current.revertingJobId).toBeNull());
});
