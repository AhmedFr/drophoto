import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach } from "vitest";
import type { MediaQuery } from "@/lib/api/media";
import { indexEntry as entry } from "@/test/mediaFactories";
import { useGalleryStore } from "../store/galleryStore";
import { useMediaIndex } from "./useMediaIndex";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  useGalleryStore.setState({
    typeFilter: "ALL",
    sort: "NEWEST",
    density: "Comfortable",
    missingOnly: false,
    query: "",
    tagId: null,
  });
  useGalleryStore.persist.clearStorage();
});

it("fetches the whole filtered set with the store's filters", async () => {
  let args: unknown;
  mockIPC((cmd, a) => {
    if (cmd === "media_index") {
      args = a;
      return [entry(1), entry(2)];
    }
    return undefined;
  });
  useGalleryStore.setState({ query: "beach", tagId: 7 });

  const { result } = renderHook(() => useMediaIndex(), { wrapper });

  await waitFor(() => expect(result.current.entries).toHaveLength(2));
  expect(args).toMatchObject({ query: { query: "beach", tag_ids: [7] } });
});

it("sends the store's sort, so the index shares query_media's ordering", async () => {
  let args: unknown;
  mockIPC((cmd, a) => {
    if (cmd === "media_index") {
      args = a;
      return [];
    }
    return undefined;
  });
  useGalleryStore.setState({ sort: "OLDEST" });

  renderHook(() => useMediaIndex(), { wrapper });

  await waitFor(() => expect(args).toBeDefined());
  expect((args as { query: MediaQuery }).query.sort).toBe("taken_asc");
});

it("queries with missing: true once the store's missingOnly flag is set", async () => {
  let args: unknown;
  mockIPC((cmd, a) => {
    if (cmd === "media_index") {
      args = a;
      return [];
    }
    return undefined;
  });
  useGalleryStore.setState({ missingOnly: true });

  renderHook(() => useMediaIndex(), { wrapper });

  await waitFor(() => expect(args).toBeDefined());
  expect((args as { query: MediaQuery }).query.missing).toBe(true);
});

it("surfaces query errors", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });

  const { result } = renderHook(() => useMediaIndex(), { wrapper });

  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error).toBeInstanceOf(Error);
});

// `buildLayout` is memoized on the entries array's identity, so an empty
// result that allocated a fresh `[]` every render would rebuild the whole
// layout on every render of the gallery.
it("keeps a referentially stable entries array while there is no data", () => {
  mockIPC(() => undefined);

  const { result, rerender } = renderHook(() => useMediaIndex(), { wrapper });
  const first = result.current.entries;

  rerender();

  expect(result.current.entries).toBe(first);
});
