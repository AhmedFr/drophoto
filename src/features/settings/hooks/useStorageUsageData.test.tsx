import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { useStorageUsageData } from "./useStorageUsageData";

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function render() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useStorageUsageData(), { wrapper: wrapperFor(queryClient) });
}

it("loads storage usage on mount", async () => {
  mockIPC((cmd) => {
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 1, previews_bytes: 2, catalog_bytes: 3, total_bytes: 6, file_count: 1 };
    }
    return undefined;
  });

  const { result } = render();
  expect(result.current.storageLoading).toBe(true);

  await waitFor(() => expect(result.current.storage?.total_bytes).toBe(6));
});

it("does not query get_settings or tool_health — Library never renders those sections", async () => {
  const commands: string[] = [];
  mockIPC((cmd) => {
    commands.push(cmd);
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.storage).not.toBeNull());
  expect(commands).not.toContain("get_settings");
  expect(commands).not.toContain("tool_health");
});

it("surfaces a storage_usage query error message", async () => {
  mockIPC((cmd) => {
    if (cmd === "storage_usage") throw { code: "io", message: "boom" };
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.storageError).toBe("boom"));
});

it("refreshStorage refetches storage_usage and reports storageRefreshing while in flight", async () => {
  let calls = 0;
  mockIPC((cmd) => {
    if (cmd === "storage_usage") {
      calls += 1;
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.storage).not.toBeNull());
  expect(calls).toBe(1);
  expect(result.current.storageRefreshing).toBe(false);

  act(() => result.current.refreshStorage());
  await waitFor(() => expect(calls).toBe(2));
});
