import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { useGalleryStore } from "../store/galleryStore";
import { useMediaCount } from "./useMediaCount";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  // Every view-state field is reset, not just the persisted three: each
  // test below sets one of missingOnly/tagId/query, and without this they
  // leak into the tests that follow.
  useGalleryStore.setState({
    typeFilter: "ALL",
    sort: "NEWEST",
    density: "Comfortable",
    missingOnly: false,
    tagId: null,
    query: "",
  });
  useGalleryStore.persist.clearStorage();
});

it("returns the count from count_media, queried with limit 1", async () => {
  let args: unknown;
  mockIPC((cmd, a) => {
    if (cmd === "count_media") {
      args = a;
      return 137;
    }
    return undefined;
  });

  const { result } = renderHook(() => useMediaCount(), { wrapper });

  await waitFor(() => expect(result.current).toBe(137));
  expect(args).toMatchObject({ query: { limit: 1, offset: 0, missing: false } });
});

it("queries with missing: true once the store's missingOnly flag is set", async () => {
  useGalleryStore.setState({ missingOnly: true });
  let args: unknown;
  mockIPC((cmd, a) => {
    if (cmd === "count_media") {
      args = a;
      return 3;
    }
    return undefined;
  });

  const { result } = renderHook(() => useMediaCount(), { wrapper });

  await waitFor(() => expect(result.current).toBe(3));
  expect(args).toMatchObject({ query: { missing: true } });
});

it("queries with tag_ids once the store's tagId is set", async () => {
  useGalleryStore.setState({ tagId: 7 });
  let args: unknown;
  mockIPC((cmd, a) => {
    if (cmd === "count_media") {
      args = a;
      return 5;
    }
    return undefined;
  });

  const { result } = renderHook(() => useMediaCount(), { wrapper });

  await waitFor(() => expect(result.current).toBe(5));
  expect(args).toMatchObject({ query: { tag_ids: [7] } });
});

// The toolbar count must narrow with the search box; otherwise it keeps
// reporting the whole library while the grid shows a handful of matches.
it("queries with the search text once the store's query is set", async () => {
  useGalleryStore.setState({ query: "beach" });
  let args: unknown;
  mockIPC((cmd, a) => {
    if (cmd === "count_media") {
      args = a;
      return 2;
    }
    return undefined;
  });

  const { result } = renderHook(() => useMediaCount(), { wrapper });

  await waitFor(() => expect(result.current).toBe(2));
  expect(args).toMatchObject({ query: { query: "beach" } });
});
