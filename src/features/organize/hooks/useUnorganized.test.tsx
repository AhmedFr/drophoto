import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { useUnorganized } from "./useUnorganized";

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

const summary = {
  drive_id: 1,
  count: 3,
  total: 5,
  bytes: 3000,
  photos: 2,
  videos: 1,
  earliest: "2025-09-01T00:00:00Z",
  latest: "2025-09-12T00:00:00Z",
};

beforeEach(async () => {
  const { listen } = await import("@tauri-apps/api/event");
  vi.mocked(listen).mockResolvedValue(vi.fn());
});

it("joins online drives with their unorganized summary", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive, offlineDrive];
    if (cmd === "list_unorganized_summaries") return [summary];
    if (cmd === "count_media") return 10;
    return undefined;
  });

  const { result } = renderHook(() => useUnorganized(), { wrapper });

  await waitFor(() => expect(result.current.rows).toHaveLength(1));
  expect(result.current.rows[0]).toMatchObject({ ...summary, drive: onlineDrive });
});

it("synthesizes a zero-count summary for a drive never scanned", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_unorganized_summaries") return [];
    if (cmd === "count_media") return 0;
    return undefined;
  });

  const { result } = renderHook(() => useUnorganized(), { wrapper });

  await waitFor(() => expect(result.current.rows).toHaveLength(1));
  expect(result.current.rows[0]).toMatchObject({
    drive_id: 1,
    count: 0,
    total: 0,
    bytes: 0,
    photos: 0,
    videos: 0,
    earliest: null,
    latest: null,
  });
});

it("derives organizedCount as total media minus unorganized across all drives", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_unorganized_summaries") return [summary];
    if (cmd === "count_media") return 10;
    return undefined;
  });

  const { result } = renderHook(() => useUnorganized(), { wrapper });

  await waitFor(() => expect(result.current.organizedCount).toBe(7));
});

it("calls start_scan for the given drive id", async () => {
  let scanArgs: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_unorganized_summaries") return [summary];
    if (cmd === "count_media") return 10;
    if (cmd === "start_scan") {
      scanArgs = args;
      return "scan-0";
    }
    return undefined;
  });

  const { result } = renderHook(() => useUnorganized(), { wrapper });
  await waitFor(() => expect(result.current.rows).toHaveLength(1));

  result.current.scan(1);

  await waitFor(() => expect(scanArgs).toEqual({ driveId: 1 }));
});

it("invalidates unorganized and media-count queries when a job finishes", async () => {
  const { listen } = await import("@tauri-apps/api/event");
  let jobHandler: ((event: { payload: unknown }) => void) | undefined;
  vi.mocked(listen).mockImplementation((name, cb) => {
    if (name === "job") jobHandler = cb as (event: { payload: unknown }) => void;
    return Promise.resolve(vi.fn());
  });
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_unorganized_summaries") return [summary];
    if (cmd === "count_media") return 10;
    return undefined;
  });

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  renderHook(() => useUnorganized(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });

  await waitFor(() => expect(jobHandler).toBeDefined());
  jobHandler?.({ payload: { kind: "finished", job_id: "scan-0", ok: 3, failed: 0, skipped: 0 } });

  await waitFor(() => {
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["unorganized"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["media-count"] });
  });
});
