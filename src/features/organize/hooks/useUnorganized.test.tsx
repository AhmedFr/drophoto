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
  legacy: 0,
  has_sources: true,
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

it("excludes legacy rows from organizedCount — a legacy row isn't organized, just uncounted", async () => {
  const summaryWithLegacy = { ...summary, legacy: 2 };
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_unorganized_summaries") return [summaryWithLegacy];
    if (cmd === "count_media") return 10;
    return undefined;
  });

  const { result } = renderHook(() => useUnorganized(), { wrapper });

  // total 10, count 3 (unorganized-and-organizable), legacy 2 -> 10-3-2 = 5,
  // not 7 (which would wrongly count the 2 legacy rows as organized).
  await waitFor(() => expect(result.current.organizedCount).toBe(5));
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

  await waitFor(() => expect(scanArgs).toEqual({ driveId: 1, full: false }));
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

// A failed `start_scan` used to vanish: the button stopped saying
// "SCANNING…" and nothing else changed on screen.
it("surfaces a failed scan with the drive it was for", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_unorganized_summaries") return [summary];
    if (cmd === "count_media") return 10;
    if (cmd === "start_scan") throw new Error("a scan job is already running on this drive");
    return undefined;
  });

  const { result } = renderHook(() => useUnorganized(), { wrapper });
  await waitFor(() => expect(result.current.rows).toHaveLength(1));

  result.current.scan(onlineDrive.id);

  await waitFor(() =>
    expect(result.current.scanError).toEqual({
      driveId: onlineDrive.id,
      message: "a scan job is already running on this drive",
    }),
  );
});

it("reports no scan error before any scan is attempted", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_unorganized_summaries") return [summary];
    if (cmd === "count_media") return 10;
    return undefined;
  });

  const { result } = renderHook(() => useUnorganized(), { wrapper });
  await waitFor(() => expect(result.current.rows).toHaveLength(1));
  expect(result.current.scanError).toBeNull();
});

// `has_sources` comes straight from the summary; a drive with no summary
// row at all gets the synthetic zero-summary, which must not claim to
// have sources it was never asked about.
it("defaults has_sources to false for a drive with no summary row", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_drives") return [onlineDrive];
    if (cmd === "list_unorganized_summaries") return [];
    if (cmd === "count_media") return 0;
    return undefined;
  });

  const { result } = renderHook(() => useUnorganized(), { wrapper });
  await waitFor(() => expect(result.current.rows).toHaveLength(1));
  expect(result.current.rows[0].has_sources).toBe(false);
});
