import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { useDashboard } from "./useDashboard";

vi.mock("@tauri-apps/api/event");

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const onlineDrive = {
  id: 1,
  name: "Kodachrome",
  volume_uuid: null,
  mount_path: "/Volumes/Kodachrome",
  role: "archive" as const,
  capacity: 2_000_000_000,
  free: 1_500_000_000,
  last_seen_at: "2026-08-22T00:00:00Z",
  online: true,
};

const offlineDrive = { ...onlineDrive, id: 2, name: "Offline Drive", online: false, mount_path: null };

const job = {
  id: 1,
  drive_id: 1,
  drive_name: "Kodachrome",
  status: "done",
  planned: 10,
  moved: 9,
  skipped: 1,
  failed: 0,
  started_at: "2026-08-22T00:00:00Z",
  finished_at: "2026-08-22T00:05:00Z",
};

const summary = {
  drive_id: 1,
  count: 4,
  total: 6,
  bytes: 4000,
  photos: 3,
  videos: 1,
  earliest: "2025-09-01T00:00:00Z",
  latest: "2025-09-12T00:00:00Z",
};

function baseMock(overrides: Partial<Record<string, unknown>> = {}) {
  return (cmd: string, args?: InvokeArgs) => {
    if (cmd === "list_drives") return [onlineDrive, offlineDrive];
    if (cmd === "list_jobs") return [job];
    if (cmd === "list_unorganized_summaries") return [summary];
    if (cmd === "count_media") {
      const query = (args as { query?: { kinds: string[] } } | undefined)?.query;
      const kinds = query?.kinds ?? [];
      if (kinds.includes("photo")) return 120;
      if (kinds.includes("video")) return 8;
      return 0;
    }
    return overrides[cmd];
  };
}

beforeEach(async () => {
  const { listen } = await import("@tauri-apps/api/event");
  vi.mocked(listen).mockResolvedValue(vi.fn());
});

it("composes drives, jobs, unorganized count, and photo/video counts", async () => {
  mockIPC(baseMock());

  const { result } = renderHook(() => useDashboard(), { wrapper });

  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.drives).toEqual([onlineDrive, offlineDrive]);
  expect(result.current.jobs).toEqual([job]);
  expect(result.current.photoCount).toBe(120);
  expect(result.current.videoCount).toBe(8);
  expect(result.current.unorganizedCount).toBe(4);
});

it("invalidates jobs, unorganized, and media-count-kind queries when a job finishes", async () => {
  const { listen } = await import("@tauri-apps/api/event");
  let jobHandler: ((event: { payload: unknown }) => void) | undefined;
  vi.mocked(listen).mockImplementation((name, cb) => {
    if (name === "job") jobHandler = cb as (event: { payload: unknown }) => void;
    return Promise.resolve(vi.fn());
  });
  mockIPC(baseMock());

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  renderHook(() => useDashboard(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });

  await waitFor(() => expect(jobHandler).toBeDefined());
  jobHandler?.({ payload: { kind: "finished", job_id: "1", ok: 9, failed: 0, skipped: 1 } });

  await waitFor(() => {
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["jobs"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["unorganized"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["media-count-kind"] });
  });
});

it("invalidates jobs, unorganized, and media-count-kind queries when a job is cancelled", async () => {
  const { listen } = await import("@tauri-apps/api/event");
  let jobHandler: ((event: { payload: unknown }) => void) | undefined;
  vi.mocked(listen).mockImplementation((name, cb) => {
    if (name === "job") jobHandler = cb as (event: { payload: unknown }) => void;
    return Promise.resolve(vi.fn());
  });
  mockIPC(baseMock());

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  renderHook(() => useDashboard(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });

  await waitFor(() => expect(jobHandler).toBeDefined());
  jobHandler?.({ payload: { kind: "cancelled", job_id: "1" } });

  await waitFor(() => {
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["jobs"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["unorganized"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["media-count-kind"] });
  });
});

it("invalidates drives when a drives:changed event arrives", async () => {
  const { listen } = await import("@tauri-apps/api/event");
  let drivesHandler: ((event: { payload: unknown }) => void) | undefined;
  vi.mocked(listen).mockImplementation((name, cb) => {
    if (name === "drives:changed") drivesHandler = cb as (event: { payload: unknown }) => void;
    return Promise.resolve(vi.fn());
  });
  mockIPC(baseMock());

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  renderHook(() => useDashboard(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });

  await waitFor(() => expect(drivesHandler).toBeDefined());
  drivesHandler?.({ payload: null });

  await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["drives"] }));
});

it("surfaces the first query error via isError/error", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_jobs") throw new Error("boom");
    if (cmd === "list_unorganized_summaries") return [summary];
    if (cmd === "count_media") return 0;
    return undefined;
  });

  const { result } = renderHook(() => useDashboard(), { wrapper });

  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error?.message).toBe("boom");
});
