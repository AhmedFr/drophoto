import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { useToolHealthData } from "./useToolHealthData";

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function render() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useToolHealthData(), { wrapper: wrapperFor(queryClient) });
}

it("exposes the tool-health snapshot once its query resolves", async () => {
  mockIPC((cmd) => {
    if (cmd === "tool_health") {
      return {
        exiftool: { path: "/opt/homebrew/bin/exiftool", version: "13.10", outdated: false },
        ffmpeg: { path: null, version: null, outdated: false },
      };
    }
    return undefined;
  });

  const { result } = render();
  expect(result.current.toolsLoading).toBe(true);

  await waitFor(() =>
    expect(result.current.tools).toEqual({
      exiftool: { path: "/opt/homebrew/bin/exiftool", version: "13.10", outdated: false },
      ffmpeg: { path: null, version: null, outdated: false },
    }),
  );
  expect(result.current.toolsLoading).toBe(false);
});

it("does not query get_settings or storage_usage — Maintenance's tools section never uses those", async () => {
  const commands: string[] = [];
  mockIPC((cmd) => {
    commands.push(cmd);
    if (cmd === "tool_health") {
      return {
        exiftool: { path: null, version: null, outdated: false },
        ffmpeg: { path: null, version: null, outdated: false },
      };
    }
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.tools).not.toBeNull());
  expect(commands).not.toContain("get_settings");
  expect(commands).not.toContain("storage_usage");
});

it("surfaces a tool_health query error message", async () => {
  mockIPC((cmd) => {
    if (cmd === "tool_health") throw { code: "io", message: "boom" };
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.toolsError).toBe("boom"));
});
