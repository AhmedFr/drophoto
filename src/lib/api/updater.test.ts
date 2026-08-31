import { vi } from "vitest";
import { checkForUpdate, downloadAndInstallUpdate, getCurrentVersion, relaunchApp } from "./updater";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

it("resolves null when the plugin finds no update", async () => {
  const { check } = await import("@tauri-apps/plugin-updater");
  vi.mocked(check).mockResolvedValue(null);

  await expect(checkForUpdate()).resolves.toBeNull();
});

it("resolves version and notes when an update is available", async () => {
  const { check } = await import("@tauri-apps/plugin-updater");
  vi.mocked(check).mockResolvedValue({
    version: "0.4.0",
    body: "Bug fixes.",
    downloadAndInstall: vi.fn(),
    // A plain function, not `vi.fn()` — `beforeEach`'s `vi.resetAllMocks()`
    // would otherwise reset this mock's implementation once a *later* test
    // calls `checkForUpdate()` again and finds it still sitting in the
    // module-level `pendingUpdate` from this test, turning `.close()` into
    // a call that returns `undefined` instead of a promise.
    close: () => Promise.resolve(),
  } as never);

  await expect(checkForUpdate()).resolves.toEqual({ version: "0.4.0", notes: "Bug fixes." });
});

it("resolves notes as null when the release has no body", async () => {
  const { check } = await import("@tauri-apps/plugin-updater");
  vi.mocked(check).mockResolvedValue({
    version: "0.4.0",
    body: undefined,
    downloadAndInstall: vi.fn(),
    // A plain function, not `vi.fn()` — `beforeEach`'s `vi.resetAllMocks()`
    // would otherwise reset this mock's implementation once a *later* test
    // calls `checkForUpdate()` again and finds it still sitting in the
    // module-level `pendingUpdate` from this test, turning `.close()` into
    // a call that returns `undefined` instead of a promise.
    close: () => Promise.resolve(),
  } as never);

  await expect(checkForUpdate()).resolves.toEqual({ version: "0.4.0", notes: null });
});

it("closes the previous pending update (best-effort) before a re-check replaces it", async () => {
  const { check } = await import("@tauri-apps/plugin-updater");
  const firstClose = vi.fn().mockResolvedValue(undefined);
  vi.mocked(check).mockResolvedValueOnce({
    version: "0.4.0",
    body: null,
    downloadAndInstall: vi.fn(),
    close: firstClose,
  } as never);
  await checkForUpdate();

  vi.mocked(check).mockResolvedValueOnce({
    version: "0.5.0",
    body: null,
    downloadAndInstall: vi.fn(),
    // A plain function, not `vi.fn()` — `beforeEach`'s `vi.resetAllMocks()`
    // would otherwise reset this mock's implementation once a *later* test
    // calls `checkForUpdate()` again and finds it still sitting in the
    // module-level `pendingUpdate` from this test, turning `.close()` into
    // a call that returns `undefined` instead of a promise.
    close: () => Promise.resolve(),
  } as never);
  await checkForUpdate();

  expect(firstClose).toHaveBeenCalledTimes(1);
});

it("does not let a rejected close() from the previous update break the new check", async () => {
  const { check } = await import("@tauri-apps/plugin-updater");
  vi.mocked(check).mockResolvedValueOnce({
    version: "0.4.0",
    body: null,
    downloadAndInstall: vi.fn(),
    close: vi.fn().mockRejectedValue(new Error("already closed")),
  } as never);
  await checkForUpdate();

  vi.mocked(check).mockResolvedValueOnce(null);
  await expect(checkForUpdate()).resolves.toBeNull();
});

it("propagates a rejection from check()", async () => {
  const { check } = await import("@tauri-apps/plugin-updater");
  vi.mocked(check).mockRejectedValue(new Error("placeholder pubkey"));

  await expect(checkForUpdate()).rejects.toThrow("placeholder pubkey");
});

it("throws from downloadAndInstallUpdate when no update was found first", async () => {
  const { check } = await import("@tauri-apps/plugin-updater");
  vi.mocked(check).mockResolvedValue(null);
  await checkForUpdate();

  await expect(downloadAndInstallUpdate(() => {})).rejects.toThrow("No update available to install.");
});

it("reports whole-percent progress computed from Started/Progress events, then 100 on Finished", async () => {
  const { check } = await import("@tauri-apps/plugin-updater");
  const downloadAndInstall = vi.fn(async (onEvent: (e: unknown) => void) => {
    onEvent({ event: "Started", data: { contentLength: 200 } });
    onEvent({ event: "Progress", data: { chunkLength: 50 } });
    onEvent({ event: "Progress", data: { chunkLength: 50 } });
    onEvent({ event: "Finished" });
  });
  vi.mocked(check).mockResolvedValue({
    version: "0.4.0",
    body: null,
    downloadAndInstall,
    // A plain function, not `vi.fn()` — `beforeEach`'s `vi.resetAllMocks()`
    // would otherwise reset this mock's implementation once a *later* test
    // calls `checkForUpdate()` again and finds it still sitting in the
    // module-level `pendingUpdate` from this test, turning `.close()` into
    // a call that returns `undefined` instead of a promise.
    close: () => Promise.resolve(),
  } as never);
  await checkForUpdate();

  const percents: number[] = [];
  await downloadAndInstallUpdate((p) => percents.push(p));

  expect(percents).toEqual([25, 50, 100]);
});

it("reports 0 progress for a Progress event when content length is unknown", async () => {
  const { check } = await import("@tauri-apps/plugin-updater");
  const downloadAndInstall = vi.fn(async (onEvent: (e: unknown) => void) => {
    onEvent({ event: "Started", data: {} });
    onEvent({ event: "Progress", data: { chunkLength: 50 } });
  });
  vi.mocked(check).mockResolvedValue({
    version: "0.4.0",
    body: null,
    downloadAndInstall,
    // A plain function, not `vi.fn()` — `beforeEach`'s `vi.resetAllMocks()`
    // would otherwise reset this mock's implementation once a *later* test
    // calls `checkForUpdate()` again and finds it still sitting in the
    // module-level `pendingUpdate` from this test, turning `.close()` into
    // a call that returns `undefined` instead of a promise.
    close: () => Promise.resolve(),
  } as never);
  await checkForUpdate();

  const percents: number[] = [];
  await downloadAndInstallUpdate((p) => percents.push(p));

  expect(percents).toEqual([0]);
});

it("relaunches the app via the process plugin", async () => {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  vi.mocked(relaunch).mockResolvedValue(undefined);

  await relaunchApp();

  expect(relaunch).toHaveBeenCalledTimes(1);
});

it("gets the current app version", async () => {
  const { getVersion } = await import("@tauri-apps/api/app");
  vi.mocked(getVersion).mockResolvedValue("0.3.0");

  await expect(getCurrentVersion()).resolves.toBe("0.3.0");
});
