import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { usePlaces } from "./usePlaces";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function placeCount(id: number, name: string) {
  return {
    place: { id, lat: 1, lon: 2, name, admin: null, country: "Portugal", source: "geocoder" as const },
    count: 3,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("loads place counts from list_place_counts", async () => {
  mockIPC((cmd) => (cmd === "list_place_counts" ? [placeCount(1, "Lisbon")] : undefined));

  const { result } = renderHook(() => usePlaces(), { wrapper });

  await waitFor(() => expect(result.current.placeCounts).toEqual([placeCount(1, "Lisbon")]));
});

it("starts online when navigator.onLine is true", async () => {
  vi.stubGlobal("navigator", { ...navigator, onLine: true });
  mockIPC((cmd) => (cmd === "list_place_counts" ? [] : undefined));

  const { result } = renderHook(() => usePlaces(), { wrapper });

  expect(result.current.online).toBe(true);
});

it("starts offline when navigator.onLine is false at mount", async () => {
  vi.stubGlobal("navigator", { ...navigator, onLine: false });
  mockIPC((cmd) => (cmd === "list_place_counts" ? [] : undefined));

  const { result } = renderHook(() => usePlaces(), { wrapper });

  expect(result.current.online).toBe(false);
});

it("flips online to false when reportMapError is called", async () => {
  vi.stubGlobal("navigator", { ...navigator, onLine: true });
  mockIPC((cmd) => (cmd === "list_place_counts" ? [] : undefined));

  const { result } = renderHook(() => usePlaces(), { wrapper });
  expect(result.current.online).toBe(true);

  result.current.reportMapError();

  await waitFor(() => expect(result.current.online).toBe(false));
});

it("surfaces a structured error message", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });

  const { result } = renderHook(() => usePlaces(), { wrapper });

  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.error).toBe("boom");
});
