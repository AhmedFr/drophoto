import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { toast } from "sonner";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import { useGeneralSettingsData } from "./useGeneralSettingsData";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

beforeEach(() => {
  useJobsStore.setState({ events: {}, labels: {}, samples: {} });
  vi.mocked(toast.error).mockClear();
});

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function render() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useGeneralSettingsData(), { wrapper: wrapperFor(queryClient) });
}

it("loads settings and the previews byte count on mount", async () => {
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { preview_edge: 2000, thumbs_dir: null };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 1, previews_bytes: 2, catalog_bytes: 3, total_bytes: 6, file_count: 1 };
    }
    return undefined;
  });

  const { result } = render();
  expect(result.current.settingsLoading).toBe(true);

  await waitFor(() => expect(result.current.settings).toEqual({ preview_edge: 2000, thumbs_dir: null }));
  await waitFor(() => expect(result.current.previewsBytes).toBe(2));
});

it("does not query tool_health — General never renders the tools section", async () => {
  const commands: string[] = [];
  mockIPC((cmd) => {
    commands.push(cmd);
    if (cmd === "get_settings") return { preview_edge: 2000, thumbs_dir: null };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.settings).not.toBeNull());
  expect(commands).not.toContain("tool_health");
});

it("surfaces a settings query error message", async () => {
  mockIPC((cmd) => {
    if (cmd === "get_settings") throw { code: "db", message: "boom" };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.settingsError).toBe("boom"));
});

it("regenApplicable is derived from the persisted setting, not the mutation response", async () => {
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { preview_edge: 2000, thumbs_dir: null };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    if (cmd === "set_preview_quality") return null;
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.settings).toEqual({ preview_edge: 2000, thumbs_dir: null }));
  expect(result.current.regenApplicable).toBe(false);

  act(() => result.current.applyQuality(800));
  await waitFor(() => expect(result.current.applyingQuality).toBe(false));
  expect(result.current.regenApplicable).toBe(false);
});

it("regenApplicable is true whenever the persisted preview_edge is below max", async () => {
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { preview_edge: 800 };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.settings).toEqual({ preview_edge: 800 }));
  expect(result.current.regenApplicable).toBe(true);
});

it("reports regenRunning from the global jobs store", async () => {
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { preview_edge: 2000, thumbs_dir: null };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.settings).not.toBeNull());
  expect(result.current.regenRunning).toBe(false);

  act(() => useJobsStore.getState().applyEvent({ kind: "started", job_id: "regen-0" }));
  await waitFor(() => expect(result.current.regenRunning).toBe(true));

  act(() =>
    useJobsStore.getState().applyEvent({ kind: "finished", job_id: "regen-0", ok: 3, failed: 0, skipped: 0 }),
  );
  await waitFor(() => expect(result.current.regenRunning).toBe(false));
});

it("startRegen calls start_regen_previews", async () => {
  const startRegenSpy = vi.fn().mockReturnValue("regen-0");
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { preview_edge: 2000, thumbs_dir: null };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    if (cmd === "start_regen_previews") return startRegenSpy();
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.settings).not.toBeNull());

  act(() => result.current.startRegen());
  await waitFor(() => expect(startRegenSpy).toHaveBeenCalledTimes(1));
});

// Regression test for review finding 2: `start_regen_previews` can be
// refused (e.g. the auto-fired geocode sweep already holds the drive-0
// admission bucket) with nothing else in the UI reacting — `regenRunning`
// never flips — so the failure must be toasted rather than swallowed.
it("toasts start_regen_previews' rejection message", async () => {
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { preview_edge: 2000, thumbs_dir: null };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    if (cmd === "start_regen_previews") {
      throw { code: "unsupported", message: "a geocode sweep is already running" };
    }
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.settings).not.toBeNull());

  act(() => result.current.startRegen());

  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("a geocode sweep is already running"));
});
