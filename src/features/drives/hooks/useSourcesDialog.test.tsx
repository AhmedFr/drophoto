import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import type { Drive } from "@/lib/api/drives";
import { useSourcesDialog } from "./useSourcesDialog";

vi.mock("@tauri-apps/plugin-dialog");

const drive: Drive = {
  id: 1,
  name: "Kodachrome",
  volume_uuid: null,
  mount_path: "/Volumes/Kodachrome",
  role: "archive",
  capacity: 2_000_000_000,
  free: 1_500_000_000,
  last_seen_at: "2026-08-22T00:00:00Z",
  online: true,
};

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

it("merges detected folders with existing sources, checking existing rows", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_sources") return [{ id: 1, drive_id: 1, rel_path: "DCIM", enabled: true }];
    if (cmd === "detect_sources") {
      return [
        { rel_path: "DCIM", media_count: 40, bytes: 1000, suggested: true },
        { rel_path: "Downloads", media_count: 2, bytes: 10, suggested: false },
      ];
    }
    return undefined;
  });

  const { result } = renderHook(() => useSourcesDialog(drive, vi.fn()), { wrapper: wrapper() });

  await waitFor(() => expect(result.current.isDetecting).toBe(false));
  await waitFor(() => expect(result.current.rows).toHaveLength(2));

  const dcim = result.current.rows.find((r) => r.rel_path === "DCIM");
  expect(dcim).toMatchObject({ checked: true, existing: true });
  const downloads = result.current.rows.find((r) => r.rel_path === "Downloads");
  expect(downloads).toMatchObject({ checked: false, existing: false });
});

it("pre-checks suggested detected folders only when there are no existing sources yet", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_sources") return [];
    if (cmd === "detect_sources") {
      return [
        { rel_path: "DCIM", media_count: 40, bytes: 1000, suggested: true },
        { rel_path: "Random", media_count: 1, bytes: 5, suggested: false },
      ];
    }
    return undefined;
  });

  const { result } = renderHook(() => useSourcesDialog(drive, vi.fn()), { wrapper: wrapper() });

  await waitFor(() => expect(result.current.rows).toHaveLength(2));
  expect(result.current.rows.find((r) => r.rel_path === "DCIM")).toMatchObject({ checked: true });
  expect(result.current.rows.find((r) => r.rel_path === "Random")).toMatchObject({ checked: false });
});

it("never shows the whole-drive row for the boot volume", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_sources") return [{ id: 1, drive_id: 1, rel_path: "", enabled: true }];
    if (cmd === "detect_sources") return [{ rel_path: "", media_count: 5, bytes: 5, suggested: true }];
    return undefined;
  });

  const bootDrive = { ...drive, mount_path: "/" };
  const { result } = renderHook(() => useSourcesDialog(bootDrive, vi.fn()), { wrapper: wrapper() });

  await waitFor(() => expect(result.current.isDetecting).toBe(false));
  expect(result.current.rows.find((r) => r.rel_path === "")).toBeUndefined();
});

it("toggle flips a row's checked state", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_sources") return [{ id: 1, drive_id: 1, rel_path: "DCIM", enabled: true }];
    if (cmd === "detect_sources") return [];
    return undefined;
  });

  const { result } = renderHook(() => useSourcesDialog(drive, vi.fn()), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.rows).toHaveLength(1));

  act(() => result.current.toggle("DCIM"));
  expect(result.current.rows[0].checked).toBe(false);
});

it("adds a folder chosen inside the mount, checked by default", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_sources") return [];
    if (cmd === "detect_sources") return [];
    return undefined;
  });
  const { open } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue("/Volumes/Kodachrome/Pictures");

  const { result } = renderHook(() => useSourcesDialog(drive, vi.fn()), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.isDetecting).toBe(false));

  await act(async () => {
    await result.current.addFolder();
  });

  expect(result.current.rows).toEqual([
    expect.objectContaining({ rel_path: "Pictures", checked: true, existing: false }),
  ]);
  expect(result.current.addError).toBeNull();
});

it("shows an inline error when the chosen folder is outside the mount", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_sources") return [];
    if (cmd === "detect_sources") return [];
    return undefined;
  });
  const { open } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue("/Volumes/Other/Pictures");

  const { result } = renderHook(() => useSourcesDialog(drive, vi.fn()), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.isDetecting).toBe(false));

  await act(async () => {
    await result.current.addFolder();
  });

  expect(result.current.addError).toBe("Folder must be on this drive");
  expect(result.current.rows).toHaveLength(0);
});

it("does nothing when the folder picker is cancelled", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_sources") return [];
    if (cmd === "detect_sources") return [];
    return undefined;
  });
  const { open } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue(null);

  const { result } = renderHook(() => useSourcesDialog(drive, vi.fn()), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.isDetecting).toBe(false));

  await act(async () => {
    await result.current.addFolder();
  });

  expect(result.current.rows).toHaveLength(0);
  expect(result.current.addError).toBeNull();
});

it("saves the checked rel paths and closes on success", async () => {
  let saveArgs: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_sources") return [{ id: 1, drive_id: 1, rel_path: "DCIM", enabled: true }];
    if (cmd === "detect_sources") return [{ rel_path: "Downloads", media_count: 1, bytes: 1, suggested: false }];
    if (cmd === "save_sources") {
      saveArgs = args;
      return null;
    }
    return undefined;
  });

  const onClose = vi.fn();
  const { result } = renderHook(() => useSourcesDialog(drive, onClose), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.rows).toHaveLength(2));

  act(() => result.current.save());

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(saveArgs).toEqual({ driveId: 1, relPaths: ["DCIM"] });
});

it("keeps existing rows checked and savable when detect_sources fails (regression: must not wipe sources)", async () => {
  let saveArgs: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_sources") {
      return [
        { id: 1, drive_id: 1, rel_path: "DCIM", enabled: true },
        { id: 2, drive_id: 1, rel_path: "Downloads", enabled: false },
      ];
    }
    if (cmd === "detect_sources") throw { code: "io", message: "walk failed" };
    if (cmd === "save_sources") {
      saveArgs = args;
      return null;
    }
    return undefined;
  });

  const onClose = vi.fn();
  const { result } = renderHook(() => useSourcesDialog(drive, onClose), { wrapper: wrapper() });

  await waitFor(() => expect(result.current.isDetecting).toBe(false));
  expect(result.current.detectError).toBe("walk failed");
  expect(result.current.rows).toEqual([
    expect.objectContaining({ rel_path: "DCIM", checked: true, existing: true }),
    expect.objectContaining({ rel_path: "Downloads", checked: false, existing: true }),
  ]);
  expect(result.current.canSave).toBe(true);

  act(() => result.current.save());

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(saveArgs).toEqual({ driveId: 1, relPaths: ["DCIM"] });
});

it("blocks saving while sourcesQuery itself has not resolved successfully", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_sources") throw { code: "db", message: "db unavailable" };
    if (cmd === "detect_sources") return [];
    return undefined;
  });

  const { result } = renderHook(() => useSourcesDialog(drive, vi.fn()), { wrapper: wrapper() });

  await waitFor(() => expect(result.current.isDetecting).toBe(false));
  expect(result.current.rows).toEqual([]);
  expect(result.current.canSave).toBe(false);
});

it("shows a distinct error when picking the boot volume's own root as a folder", async () => {
  mockIPC((cmd) => {
    if (cmd === "list_sources") return [];
    if (cmd === "detect_sources") return [];
    return undefined;
  });
  const { open } = await import("@tauri-apps/plugin-dialog");
  vi.mocked(open).mockResolvedValue("/");

  const bootDrive = { ...drive, mount_path: "/" };
  const { result } = renderHook(() => useSourcesDialog(bootDrive, vi.fn()), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.isDetecting).toBe(false));

  await act(async () => {
    await result.current.addFolder();
  });

  expect(result.current.addError).toBe("The whole boot volume can't be a source");
});
