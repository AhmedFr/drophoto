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
  expect(result.current).toEqual({ 1: [], 2: [] });
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

  await waitFor(() => expect(result.current[1]).toHaveLength(1));
  expect(result.current[1][0]).toMatchObject({ rel_path: "DCIM" });
  expect(result.current[2]).toEqual([]);
});

it("returns an empty object for an empty drive id list", () => {
  mockIPC(() => undefined);
  const { result } = renderHook(() => useSources([]), { wrapper: wrapper() });
  expect(result.current).toEqual({});
});
