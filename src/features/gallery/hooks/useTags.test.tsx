import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { it, expect, vi } from "vitest";
import { useTags } from "./useTags";

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

it("loads the full tag list", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [{ id: 1, name: "Family" }, { id: 2, name: "Beach" }];
    if (cmd === "tags_for_media") return [];
    return undefined;
  });

  const { result } = renderHook(() => useTags([1]), { wrapper: wrapper() });

  await waitFor(() =>
    expect(result.current.allTags).toEqual([
      { id: 1, name: "Family" },
      { id: 2, name: "Beach" },
    ]),
  );
});

it("marks a tag 'all' when every selected id has it", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [{ id: 1, name: "Family" }];
    if (cmd === "tags_for_media") {
      return [
        [1, { id: 1, name: "Family" }],
        [2, { id: 1, name: "Family" }],
      ];
    }
    return undefined;
  });

  const { result } = renderHook(() => useTags([1, 2]), { wrapper: wrapper() });

  await waitFor(() => expect(result.current.states).toEqual({ 1: "all" }));
});

it("marks a tag 'some' when only part of the selection has it", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [{ id: 1, name: "Family" }];
    if (cmd === "tags_for_media") return [[1, { id: 1, name: "Family" }]];
    return undefined;
  });

  const { result } = renderHook(() => useTags([1, 2]), { wrapper: wrapper() });

  await waitFor(() => expect(result.current.states).toEqual({ 1: "some" }));
});

it("omits a tag from states entirely when none of the selection has it", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [{ id: 1, name: "Family" }];
    if (cmd === "tags_for_media") return [];
    return undefined;
  });

  const { result } = renderHook(() => useTags([1, 2]), { wrapper: wrapper() });

  await waitFor(() => expect(result.current.states).toEqual({}));
});

it("apply calls tag_media with mediaIds plus add/remove, then invalidates tags/media-tags/media and sweeps sidecars", async () => {
  let tagMediaArgs: unknown;
  let sidecarSyncCalled = false;
  mockIPC((cmd, args) => {
    if (cmd === "list_tags") return [{ id: 1, name: "Family" }];
    if (cmd === "tags_for_media") return [];
    if (cmd === "tag_media") {
      tagMediaArgs = args;
      return null;
    }
    if (cmd === "start_sidecar_sync_all") {
      sidecarSyncCalled = true;
      return [];
    }
    return undefined;
  });

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const { result } = renderHook(() => useTags([1, 2]), {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });

  await waitFor(() => expect(result.current.allTags).toHaveLength(1));

  act(() => result.current.apply({ add: ["Sunset"], remove: [3] }));

  await waitFor(() =>
    expect(tagMediaArgs).toEqual({ mediaIds: [1, 2], add: ["Sunset"], remove: [3] }),
  );
  await waitFor(() => expect(sidecarSyncCalled).toBe(true));
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tags"] });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["media-tags"] });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["media"] });
});

it("exposes isApplying while the mutation is in flight", async () => {
  let resolveTagMedia: (() => void) | undefined;
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [];
    if (cmd === "tags_for_media") return [];
    if (cmd === "tag_media") {
      return new Promise((resolve) => {
        resolveTagMedia = () => resolve(null);
      });
    }
    if (cmd === "start_sidecar_sync_all") return [];
    return undefined;
  });

  const { result } = renderHook(() => useTags([1]), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.isApplying).toBe(false));

  act(() => result.current.apply({ add: [], remove: [] }));
  await waitFor(() => expect(result.current.isApplying).toBe(true));

  await act(async () => {
    resolveTagMedia?.();
  });
  await waitFor(() => expect(result.current.isApplying).toBe(false));
});

it("surfaces a mutation error", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_tags") return [];
    if (cmd === "tags_for_media") return [];
    if (cmd === "tag_media") throw new Error("db locked");
    return undefined;
  });

  const { result } = renderHook(() => useTags([1]), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.states).toEqual({}));

  act(() => result.current.apply({ add: ["X"], remove: [] }));

  await waitFor(() => expect(result.current.error).toBe("db locked"));
});
