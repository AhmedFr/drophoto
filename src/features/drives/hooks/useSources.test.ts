import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createElement, type ReactNode } from "react";
import { useSources } from "./useSources";

function wrapper() {
  const queryClient = new QueryClient();
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

it("returns an empty array for each drive before the query resolves", () => {
  mockIPC(() => undefined);
  const { result } = renderHook(() => useSources([1, 2]), { wrapper: wrapper() });
  expect(result.current.sourcesByDrive).toEqual({ 1: [], 2: [] });
});

// The `[]` fallback above is indistinguishable from "this drive has no
// sources", which is why `isLoading` has to be reported separately —
// `DriveCard` would otherwise flash a red "No sources" on every mount.
it("reports isLoading while a drive's sources are still in flight, then false", async () => {
  mockIPC((cmd) => (cmd === "list_sources" ? [] : undefined));
  const { result } = renderHook(() => useSources([1]), { wrapper: wrapper() });
  expect(result.current.isLoading).toBe(true);
  await waitFor(() => expect(result.current.isLoading).toBe(false));
});

it("is not loading when there are no drives to fetch sources for", () => {
  mockIPC(() => undefined);
  const { result } = renderHook(() => useSources([]), { wrapper: wrapper() });
  expect(result.current.isLoading).toBe(false);
});

it("keys resolved sources by drive id", async () => {
  mockIPC((cmd, args) => {
    if (cmd === "list_sources") {
      const driveId = (args as { driveId: number }).driveId;
      return driveId === 1 ? [{ id: 1, drive_id: 1, rel_path: "DCIM", enabled: true }] : [];
    }
    return undefined;
  });

  const { result } = renderHook(() => useSources([1, 2]), { wrapper: wrapper() });

  await waitFor(() => expect(result.current.sourcesByDrive[1]).toHaveLength(1));
  expect(result.current.sourcesByDrive[1][0]).toMatchObject({ rel_path: "DCIM" });
  expect(result.current.sourcesByDrive[2]).toEqual([]);
});

it("returns an empty object for an empty drive id list", () => {
  mockIPC(() => undefined);
  const { result } = renderHook(() => useSources([]), { wrapper: wrapper() });
  expect(result.current.sourcesByDrive).toEqual({});
});
