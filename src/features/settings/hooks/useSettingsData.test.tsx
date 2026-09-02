import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { toast } from "sonner";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import { useSettingsData } from "./useSettingsData";

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
  return renderHook(() => useSettingsData(), { wrapper: wrapperFor(queryClient) });
}

it("loads settings and storage usage on mount", async () => {
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { preview_edge: 2000, thumbs_dir: null };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 1, previews_bytes: 2, catalog_bytes: 3, total_bytes: 6, file_count: 1 };
    }
    return undefined;
  });

  const { result } = render();
  expect(result.current.settingsLoading).toBe(true);
  expect(result.current.storageLoading).toBe(true);

  await waitFor(() => expect(result.current.settings).toEqual({ preview_edge: 2000, thumbs_dir: null }));
  await waitFor(() => expect(result.current.storage?.total_bytes).toBe(6));
});

it("exposes the tool-health snapshot once its query resolves", async () => {
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { preview_edge: 2000, thumbs_dir: null };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    if (cmd === "tool_health") {
      return {
        exiftool: { path: "/opt/homebrew/bin/exiftool", version: "13.10", outdated: false },
        ffmpeg: { path: null, version: null, outdated: false },
      };
    }
    return undefined;
  });

  const { result } = render();
  await waitFor(() =>
    expect(result.current.tools).toEqual({
      exiftool: { path: "/opt/homebrew/bin/exiftool", version: "13.10", outdated: false },
      ffmpeg: { path: null, version: null, outdated: false },
    }),
  );
  expect(result.current.toolsLoading).toBe(false);
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

it("refreshStorage refetches storage_usage without touching settings", async () => {
  let calls = 0;
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { preview_edge: 2000, thumbs_dir: null };
    if (cmd === "storage_usage") {
      calls += 1;
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.storage).not.toBeNull());
  expect(calls).toBe(1);

  act(() => result.current.refreshStorage());
  await waitFor(() => expect(calls).toBe(2));
});

it("regenApplicable is derived from the persisted setting, not the mutation response", async () => {
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { preview_edge: 2000, thumbs_dir: null };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    // `set_preview_quality` returns nothing meaningful now — the mutation
    // response is deliberately not what drives `regenApplicable`.
    if (cmd === "set_preview_quality") return null;
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.settings).toEqual({ preview_edge: 2000, thumbs_dir: null }));
  expect(result.current.regenApplicable).toBe(false);

  act(() => result.current.applyQuality(800));
  // Applying re-fetches `get_settings`; the mock always returns 2000
  // here, so `regenApplicable` must NOT flip just because the mutation
  // resolved — only a genuinely lower persisted `preview_edge` would do
  // that (covered below).
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

it("regenApplicable stays true after a regen sweep finishes — there's no durable signal that reclaiming is done", async () => {
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { preview_edge: 800 };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.regenApplicable).toBe(true));

  act(() => useJobsStore.getState().applyEvent({ kind: "started", job_id: "regen-0" }));
  await waitFor(() => expect(result.current.regenRunning).toBe(true));

  act(() =>
    useJobsStore.getState().applyEvent({ kind: "finished", job_id: "regen-0", ok: 3, failed: 0, skipped: 0 }),
  );
  await waitFor(() => expect(result.current.regenRunning).toBe(false));
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

  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("a geocode sweep is already running"),
  );
});

it("confirmResetAppData surfaces reset_app_data's rejection message via resetError", async () => {
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { preview_edge: 2000, thumbs_dir: null };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    if (cmd === "reset_app_data") {
      throw { code: "io", message: "couldn't delete thumbs directory" };
    }
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.settings).not.toBeNull());
  expect(result.current.resetError).toBeNull();

  act(() => result.current.confirmResetAppData());

  await waitFor(() => expect(result.current.resetError).toBe("couldn't delete thumbs directory"));
});

it("confirmResetAppData calls reset_app_data and reports resetting while in flight", async () => {
  let resolveReset: () => void = () => {};
  const resetPromise = new Promise<void>((resolve) => {
    resolveReset = resolve;
  });
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { preview_edge: 2000, thumbs_dir: null };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    if (cmd === "reset_app_data") return resetPromise;
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.settings).not.toBeNull());

  act(() => result.current.confirmResetAppData());
  await waitFor(() => expect(result.current.resetting).toBe(true));

  resolveReset();
  await waitFor(() => expect(result.current.resetting).toBe(false));
});

it("confirmUninstall surfaces uninstall_app's rejection message via uninstallError", async () => {
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { preview_edge: 2000, thumbs_dir: null };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    if (cmd === "uninstall_app") {
      throw { code: "unsupported", message: "not running from an installed .app bundle" };
    }
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.settings).not.toBeNull());
  expect(result.current.uninstallError).toBeNull();

  act(() => result.current.confirmUninstall());

  await waitFor(() => expect(result.current.uninstallError).toBe("not running from an installed .app bundle"));
});

it("confirmUninstall calls uninstall_app and reports uninstalling while in flight", async () => {
  let resolveUninstall: () => void = () => {};
  const uninstallPromise = new Promise<void>((resolve) => {
    resolveUninstall = resolve;
  });
  mockIPC((cmd) => {
    if (cmd === "get_settings") return { preview_edge: 2000, thumbs_dir: null };
    if (cmd === "storage_usage") {
      return { thumbs_400_bytes: 0, previews_bytes: 0, catalog_bytes: 0, total_bytes: 0, file_count: 0 };
    }
    if (cmd === "uninstall_app") return uninstallPromise;
    return undefined;
  });

  const { result } = render();
  await waitFor(() => expect(result.current.settings).not.toBeNull());

  act(() => result.current.confirmUninstall());
  await waitFor(() => expect(result.current.uninstalling).toBe(true));

  resolveUninstall();
  await waitFor(() => expect(result.current.uninstalling).toBe(false));
});
