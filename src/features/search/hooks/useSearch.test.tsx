import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { useSearch } from "./useSearch";

// Fake timers drive the debounce; each advance is wrapped in `act` (and
// awaited via `advanceTimersByTimeAsync`, which also flushes microtasks)
// so both the timer-driven state update and the query's own promise
// resolution land before assertions run — plain `waitFor` polls on a real
// timer, which never fires while fake timers are installed.
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("stays disabled and returns no items for an empty query", async () => {
  let called = false;
  mockIPC((cmd) => {
    if (cmd === "search_media") called = true;
    return [];
  });

  const { result } = renderHook(() => useSearch(""), { wrapper });

  await advance(200);

  expect(result.current.items).toEqual([]);
  expect(result.current.isFetching).toBe(false);
  expect(result.current.isDebouncing).toBe(false);
  expect(called).toBe(false);
});

it("stays disabled for a whitespace-only query even after debouncing", async () => {
  let called = false;
  mockIPC((cmd) => {
    if (cmd === "search_media") called = true;
    return [];
  });

  const { result } = renderHook(() => useSearch("   "), { wrapper });

  await advance(200);

  expect(result.current.items).toEqual([]);
  expect(called).toBe(false);
});

it("marks isDebouncing while waiting for the 200ms debounce to settle", async () => {
  mockIPC((cmd) => (cmd === "search_media" ? [] : undefined));

  const { result, rerender } = renderHook(({ query }) => useSearch(query), {
    wrapper,
    initialProps: { query: "" },
  });

  rerender({ query: "beach" });
  expect(result.current.isDebouncing).toBe(true);

  await advance(200);
  expect(result.current.isDebouncing).toBe(false);
});

it("fires search_media with the settled query once debouncing completes", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "search_media") {
      received = args;
      return [];
    }
    return undefined;
  });

  const { rerender } = renderHook(({ query }) => useSearch(query), {
    wrapper,
    initialProps: { query: "" },
  });

  rerender({ query: "beach" });
  // Not yet — still within the debounce window.
  await advance(100);
  expect(received).toBeUndefined();

  await advance(100);
  expect(received).toEqual({ query: "beach", limit: 200 });
});

it("does not refire on rapid keystrokes within the debounce window", async () => {
  let callCount = 0;
  mockIPC((cmd) => {
    if (cmd === "search_media") {
      callCount++;
      return [];
    }
    return undefined;
  });

  const { rerender } = renderHook(({ query }) => useSearch(query), {
    wrapper,
    initialProps: { query: "" },
  });

  rerender({ query: "b" });
  await advance(50);
  rerender({ query: "be" });
  await advance(50);
  rerender({ query: "bea" });
  await advance(200);

  expect(callCount).toBe(1);
});

it("keys the query on the trimmed value, sharing cache across leading/trailing whitespace", async () => {
  let callCount = 0;
  mockIPC((cmd) => {
    if (cmd === "search_media") {
      callCount++;
      return [];
    }
    return undefined;
  });

  const { rerender } = renderHook(({ query }) => useSearch(query), {
    wrapper,
    initialProps: { query: "beach" },
  });
  await advance(200);
  await advance(0);
  expect(callCount).toBe(1);

  // Same trimmed value, different raw string — must hit the same cache
  // entry rather than firing a second network call.
  rerender({ query: "  beach  " });
  await advance(200);
  await advance(0);
  expect(callCount).toBe(1);
});

it("keeps a non-empty previous result set on screen while a new query is in flight", async () => {
  let resolveSecond: ((items: unknown[]) => void) | undefined;
  let calls = 0;
  mockIPC((cmd) => {
    if (cmd !== "search_media") return undefined;
    calls++;
    if (calls === 1) return [{ row: { id: 1 } }];
    return new Promise((resolve) => {
      resolveSecond = resolve;
    });
  });

  const { result, rerender } = renderHook(({ query }) => useSearch(query), {
    wrapper,
    initialProps: { query: "" },
  });

  rerender({ query: "beach" });
  await advance(200);
  await advance(0);
  expect(result.current.items).toEqual([{ row: { id: 1 } }]);
  expect(result.current.isFetching).toBe(false);

  rerender({ query: "beaches" });
  await advance(200);

  // The second query is in flight, but the previous non-empty result set
  // must still be showing, and the loader must not reappear over it.
  expect(result.current.items).toEqual([{ row: { id: 1 } }]);
  expect(result.current.isFetching).toBe(false);

  resolveSecond?.([{ row: { id: 2 } }]);
  await advance(0);
  expect(result.current.items).toEqual([{ row: { id: 2 } }]);
});

it("shows the loader for a new query when the previous result set was empty", async () => {
  let resolveSecond: ((items: unknown[]) => void) | undefined;
  let calls = 0;
  mockIPC((cmd) => {
    if (cmd !== "search_media") return undefined;
    calls++;
    if (calls === 1) return [];
    return new Promise((resolve) => {
      resolveSecond = resolve;
    });
  });

  const { result, rerender } = renderHook(({ query }) => useSearch(query), {
    wrapper,
    initialProps: { query: "" },
  });

  rerender({ query: "nope" });
  await advance(200);
  await advance(0);
  expect(result.current.items).toEqual([]);

  rerender({ query: "nopenope" });
  await advance(200);

  expect(result.current.isFetching).toBe(true);

  resolveSecond?.([{ row: { id: 3 } }]);
  await advance(0);
  expect(result.current.items).toEqual([{ row: { id: 3 } }]);
});

it("returns the resolved items once the search settles", async () => {
  mockIPC((cmd) =>
    cmd === "search_media"
      ? [
          {
            row: {
              id: 1,
              drive_id: 1,
              rel_path: "photos/1.jpg",
              hash: "h1",
              size: 10,
              kind: "photo",
              ext: "jpg",
              width: 100,
              height: 100,
              duration_ms: null,
              taken_at: null,
              camera: null,
              lens: null,
              aperture: null,
              shutter: null,
              iso: null,
              focal_mm: null,
              lat: null,
              lon: null,
              missing_at: null,
              organized_at: null,
              source_id: null,
              place_id: null,
              mtime: null,
            },
            thumb_path: "/t/1/400.webp",
            preview_path: "/t/1/2000.webp",
            drive_name: "Kodachrome",
            online: true,
            original_path: "/Volumes/Kodachrome/photos/1.jpg",
            has_thumb: true,
          },
        ]
      : undefined,
  );

  const { result, rerender } = renderHook(({ query }) => useSearch(query), {
    wrapper,
    initialProps: { query: "" },
  });

  rerender({ query: "beach" });
  await advance(200);
  // One more (empty) tick to flush the query's own promise resolution,
  // which React Query kicks off from an effect that commits just after
  // the debounce's state update above.
  await advance(0);

  expect(result.current.items).toHaveLength(1);
  expect(result.current.items[0].row.id).toBe(1);
});
