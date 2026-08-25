import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { it, expect, vi } from "vitest";
import { PlacePanel } from "./PlacePanel";

function renderPanel(props: { mediaIds: number[]; open: boolean; onClose?: () => void }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlacePanel mediaIds={props.mediaIds} open={props.open} onClose={props.onClose ?? vi.fn()} />
    </QueryClientProvider>,
  );
}

// Fake timers drive the debounce assertions below — each advance is
// wrapped in `act` (and awaited via `advanceTimersByTimeAsync`, which also
// flushes microtasks) so both the timer-driven state update and any
// query/mutation promise resolution land before assertions run. Only the
// two timing-sensitive tests opt into fake timers (installed/uninstalled
// locally, not file-wide) — everything else uses real timers so
// `findBy*`/`waitFor`'s own internal polling still works normally.
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

it("is closed when open is false", () => {
  mockIPC(() => undefined);
  renderPanel({ mediaIds: [1], open: false });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("does not search until the input has text, even after the debounce window", async () => {
  vi.useFakeTimers();
  let called = false;
  mockIPC((cmd) => {
    if (cmd === "search_cities") called = true;
    return [];
  });
  renderPanel({ mediaIds: [1], open: true });

  await advance(200);
  vi.useRealTimers();

  expect(called).toBe(false);
  expect(screen.getByText(/type to search/i)).toBeInTheDocument();
});

it("debounces search_cities by 200ms as the user types", async () => {
  vi.useFakeTimers();
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "search_cities") {
      received = args;
      return [];
    }
    return undefined;
  });
  renderPanel({ mediaIds: [1], open: true });

  fireEvent.change(screen.getByPlaceholderText(/search a city/i), { target: { value: "lisb" } });
  await advance(100);
  expect(received).toBeUndefined();

  await advance(100);
  vi.useRealTimers();
  expect(received).toEqual({ query: "lisb" });
});

// M4: two distinct GeoNames rows can legitimately share
// name/admin/country (e.g. a duplicated or re-surveyed entry) — the list
// key must fold in lat/lon too, or React logs a duplicate-key warning
// and can misrender/merge the rows.
it("does not warn about duplicate keys when two results share name/admin/country but differ in lat/lon", async () => {
  const warnSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  mockIPC((cmd) => {
    if (cmd === "search_cities") {
      return [
        { name: "Springfield", admin: "Illinois", country: "United States", lat: 39.78, lon: -89.65 },
        { name: "Springfield", admin: "Illinois", country: "United States", lat: 39.79, lon: -89.66 },
      ];
    }
    return undefined;
  });
  renderPanel({ mediaIds: [1], open: true });

  fireEvent.change(screen.getByPlaceholderText(/search a city/i), { target: { value: "spring" } });

  expect(await screen.findAllByText(/springfield, illinois, united states/i)).toHaveLength(2);
  const duplicateKeyWarning = warnSpy.mock.calls.some((args) =>
    args.some((arg) => typeof arg === "string" && arg.includes("same key")),
  );
  expect(duplicateKeyWarning).toBe(false);
  warnSpy.mockRestore();
});

it("shows city results and 'No cities found' when empty", async () => {
  mockIPC((cmd) => {
    if (cmd === "search_cities") return [];
    return undefined;
  });
  renderPanel({ mediaIds: [1], open: true });

  fireEvent.change(screen.getByPlaceholderText(/search a city/i), { target: { value: "zzz" } });

  expect(await screen.findByText(/no cities found/i)).toBeInTheDocument();
});

it("picking a city applies the override and closes on success", async () => {
  let setMediaPlaceArgs: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "search_cities") {
      return [{ name: "Lisbon", admin: "Lisboa", country: "Portugal", lat: 38.7, lon: -9.1 }];
    }
    if (cmd === "set_media_place") {
      setMediaPlaceArgs = args;
      return null;
    }
    return undefined;
  });
  const onClose = vi.fn();
  renderPanel({ mediaIds: [1, 2], open: true, onClose });

  fireEvent.change(screen.getByPlaceholderText(/search a city/i), { target: { value: "lisb" } });

  const cityButton = await screen.findByText(/lisbon, lisboa, portugal/i);
  fireEvent.click(cityButton);

  await waitFor(() =>
    expect(setMediaPlaceArgs).toEqual({
      mediaIds: [1, 2],
      city: { name: "Lisbon", admin: "Lisboa", country: "Portugal", lat: 38.7, lon: -9.1 },
    }),
  );
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it("CLEAR PLACE sends a null city and closes on success", async () => {
  let setMediaPlaceArgs: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "set_media_place") {
      setMediaPlaceArgs = args;
      return null;
    }
    return undefined;
  });
  const onClose = vi.fn();
  renderPanel({ mediaIds: [1], open: true, onClose });

  fireEvent.click(screen.getByRole("button", { name: /clear place/i }));

  await waitFor(() => expect(setMediaPlaceArgs).toEqual({ mediaIds: [1], city: null }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it("CANCEL closes without applying anything", () => {
  mockIPC(() => undefined);
  const onClose = vi.fn();
  renderPanel({ mediaIds: [1], open: true, onClose });

  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

  expect(onClose).toHaveBeenCalled();
});

it("shows an inline error and does not close when set_media_place fails", async () => {
  mockIPC((cmd) => {
    if (cmd === "set_media_place") throw new Error("db locked");
    return undefined;
  });
  const onClose = vi.fn();
  renderPanel({ mediaIds: [1], open: true, onClose });

  fireEvent.click(screen.getByRole("button", { name: /clear place/i }));

  expect(await screen.findByText("db locked")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

it("resets the input when the dialog re-opens", () => {
  mockIPC((cmd) => (cmd === "search_cities" ? [] : undefined));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <PlacePanel mediaIds={[1]} open={true} onClose={vi.fn()} />
    </QueryClientProvider>,
  );

  fireEvent.change(screen.getByPlaceholderText(/search a city/i), { target: { value: "lisb" } });
  expect(screen.getByPlaceholderText(/search a city/i)).toHaveValue("lisb");

  rerender(
    <QueryClientProvider client={queryClient}>
      <PlacePanel mediaIds={[1]} open={false} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  rerender(
    <QueryClientProvider client={queryClient}>
      <PlacePanel mediaIds={[1]} open={true} onClose={vi.fn()} />
    </QueryClientProvider>,
  );

  expect(screen.getByPlaceholderText(/search a city/i)).toHaveValue("");
});
