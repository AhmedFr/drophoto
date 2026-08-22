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
  useGalleryStore.setState({ typeFilter: "ALL", sort: "NEWEST", density: "Comfortable" });
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
  expect(args).toMatchObject({ query: { limit: 1, offset: 0 } });
});
