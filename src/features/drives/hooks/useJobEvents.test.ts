import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import { useJobEvents } from "./useJobEvents";

vi.mock("@tauri-apps/api/event");

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

async function captureHandler(queryClient: QueryClient = new QueryClient()) {
  const { listen } = await import("@tauri-apps/api/event");
  vi.mocked(listen).mockResolvedValue(vi.fn());
  const callsBefore = vi.mocked(listen).mock.calls.length;
  const { result } = renderHook(() => useJobEvents(), { wrapper: wrapperFor(queryClient) });
  await waitFor(() => expect(vi.mocked(listen).mock.calls.length).toBeGreaterThan(callsBefore));
  const handler = vi.mocked(listen).mock.calls[callsBefore][1];
  return { result, emit: (payload: unknown) => act(() => handler({ payload } as never)) };
}

it("stores the latest event per job id", async () => {
  const { result, emit } = await captureHandler();

  emit({ kind: "started", job_id: "scan-0" });
  await waitFor(() => expect(result.current["scan-0"]).toEqual({ kind: "started", job_id: "scan-0" }));

  emit({ kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" });
  await waitFor(() =>
    expect(result.current["scan-0"]).toEqual({
      kind: "progress",
      job_id: "scan-0",
      done: 3,
      total: 10,
      current: "a.jpg",
    }),
  );

  emit({ kind: "finished", job_id: "scan-0", ok: 9, failed: 1, skipped: 0 });
  await waitFor(() =>
    expect(result.current["scan-0"]).toEqual({ kind: "finished", job_id: "scan-0", ok: 9, failed: 1, skipped: 0 }),
  );
});

it("keeps the higher done count when progress events arrive out of order", async () => {
  const { result, emit } = await captureHandler();

  emit({ kind: "progress", job_id: "scan-0", done: 5, total: 10, current: "b.jpg" });
  await waitFor(() => expect(result.current["scan-0"]).toMatchObject({ done: 5 }));

  emit({ kind: "progress", job_id: "scan-0", done: 3, total: 10, current: "a.jpg" });

  expect(result.current["scan-0"]).toMatchObject({ done: 5, current: "b.jpg" });
});

it("tracks events for multiple jobs independently", async () => {
  const { result, emit } = await captureHandler();

  emit({ kind: "started", job_id: "scan-0" });
  emit({ kind: "started", job_id: "scan-1" });

  await waitFor(() => {
    expect(result.current["scan-0"]).toEqual({ kind: "started", job_id: "scan-0" });
    expect(result.current["scan-1"]).toEqual({ kind: "started", job_id: "scan-1" });
  });
});

it("invalidates media and media-count queries when a job finishes", async () => {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const { emit } = await captureHandler(queryClient);

  emit({ kind: "finished", job_id: "scan-0", ok: 9, failed: 1, skipped: 0 });

  await waitFor(() => {
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["media"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["media-count"] });
  });
});
