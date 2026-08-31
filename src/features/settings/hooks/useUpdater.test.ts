import { act, renderHook, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  getCurrentVersion,
  relaunchApp,
} from "@/lib/api/updater";
import { useUpdater } from "./useUpdater";

vi.mock("@/lib/api/updater", () => ({
  checkForUpdate: vi.fn(),
  downloadAndInstallUpdate: vi.fn(),
  relaunchApp: vi.fn(),
  getCurrentVersion: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCurrentVersion).mockResolvedValue("0.3.0");
});

it("auto-checks on mount exactly once, landing on upToDate when nothing is available", async () => {
  vi.mocked(checkForUpdate).mockResolvedValue(null);

  const { result, rerender } = renderHook(() => useUpdater());
  rerender();
  rerender();

  await waitFor(() => expect(result.current.status).toBe("upToDate"));
  expect(checkForUpdate).toHaveBeenCalledTimes(1);
});

it("lands on available with the version and notes when the auto-check finds one", async () => {
  vi.mocked(checkForUpdate).mockResolvedValue({ version: "0.4.0", notes: "Fixes." });

  const { result } = renderHook(() => useUpdater());

  await waitFor(() => expect(result.current.status).toBe("available"));
  expect(result.current.version).toBe("0.4.0");
  expect(result.current.notes).toBe("Fixes.");
});

it("resolves the current app version alongside the check", async () => {
  vi.mocked(checkForUpdate).mockResolvedValue(null);

  const { result } = renderHook(() => useUpdater());

  await waitFor(() => expect(result.current.currentVersion).toBe("0.3.0"));
});

it("goes checking -> error when checkForUpdate rejects, surfacing the message", async () => {
  vi.mocked(checkForUpdate).mockRejectedValue(new Error("placeholder pubkey"));

  const { result } = renderHook(() => useUpdater());

  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.error).toBe("placeholder pubkey");
});

it("check() re-runs the check from any state", async () => {
  vi.mocked(checkForUpdate).mockResolvedValueOnce(null);
  const { result } = renderHook(() => useUpdater());
  await waitFor(() => expect(result.current.status).toBe("upToDate"));

  vi.mocked(checkForUpdate).mockResolvedValueOnce({ version: "0.5.0", notes: null });
  act(() => result.current.check());

  await waitFor(() => expect(result.current.status).toBe("available"));
  expect(result.current.version).toBe("0.5.0");
  expect(checkForUpdate).toHaveBeenCalledTimes(2);
});

it("install() downloads, reporting percent as it arrives, then lands on readyToRelaunch", async () => {
  vi.mocked(checkForUpdate).mockResolvedValue({ version: "0.4.0", notes: null });
  vi.mocked(downloadAndInstallUpdate).mockImplementation(async (onProgress) => {
    onProgress(10);
    onProgress(55);
    onProgress(100);
  });

  const { result } = renderHook(() => useUpdater());
  await waitFor(() => expect(result.current.status).toBe("available"));

  act(() => result.current.install());

  await waitFor(() => expect(result.current.status).toBe("readyToRelaunch"));
  expect(result.current.percent).toBe(100);
});

it("install() surfaces an error and leaves the version intact when the download fails", async () => {
  vi.mocked(checkForUpdate).mockResolvedValue({ version: "0.4.0", notes: null });
  vi.mocked(downloadAndInstallUpdate).mockRejectedValue(new Error("disk full"));

  const { result } = renderHook(() => useUpdater());
  await waitFor(() => expect(result.current.status).toBe("available"));

  act(() => result.current.install());

  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.error).toBe("disk full");
});

it("relaunch() calls relaunchApp", async () => {
  vi.mocked(checkForUpdate).mockResolvedValue({ version: "0.4.0", notes: null });
  vi.mocked(downloadAndInstallUpdate).mockResolvedValue(undefined);
  vi.mocked(relaunchApp).mockResolvedValue(undefined);

  const { result } = renderHook(() => useUpdater());
  await waitFor(() => expect(result.current.status).toBe("available"));
  act(() => result.current.install());
  await waitFor(() => expect(result.current.status).toBe("readyToRelaunch"));

  act(() => result.current.relaunch());

  await waitFor(() => expect(relaunchApp).toHaveBeenCalledTimes(1));
});
