import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { useMissingCount } from "./useMissingCount";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

it("returns the count from count_media, queried with missing: true", async () => {
  let args: unknown;
  mockIPC((cmd, a) => {
    if (cmd === "count_media") {
      args = a;
      return 5;
    }
    return undefined;
  });

  const { result } = renderHook(() => useMissingCount(), { wrapper });

  await waitFor(() => expect(result.current).toBe(5));
  expect(args).toMatchObject({ query: { missing: true, limit: 1, offset: 0 } });
});
