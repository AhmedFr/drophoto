import { mockIPC } from "@tauri-apps/api/mocks";
import { checkSidecarFiles, sidecarHealth, startSidecarSyncAll } from "./sidecars";
import type { SidecarHealth } from "./sidecars";
import { ApiError } from "./client";

it("starts a sidecar sync sweep with no arguments and returns the started job ids", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "start_sidecar_sync_all") {
      received = args;
      return ["sidecar-0", "sidecar-1"];
    }
    return undefined;
  });
  await expect(startSidecarSyncAll()).resolves.toEqual(["sidecar-0", "sidecar-1"]);
  expect(received).toEqual({});
});

it("wraps structured errors from start_sidecar_sync_all", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(startSidecarSyncAll()).rejects.toBeInstanceOf(ApiError);
});

it("gets a drive's sidecar health, round-tripping the drive id", async () => {
  const health: SidecarHealth = { tagged: 12, pending: 3 };
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "sidecar_health") {
      received = args;
      return health;
    }
    return undefined;
  });
  await expect(sidecarHealth(7)).resolves.toEqual(health);
  expect(received).toEqual({ driveId: 7 });
});

it("wraps structured errors from sidecar_health", async () => {
  mockIPC(() => {
    throw { code: "db", message: "boom" };
  });
  await expect(sidecarHealth(7)).rejects.toBeInstanceOf(ApiError);
});

it("checks sidecar files, round-tripping the drive id and returning the missing count", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "check_sidecar_files") {
      received = args;
      return 2;
    }
    return undefined;
  });
  await expect(checkSidecarFiles(7)).resolves.toBe(2);
  expect(received).toEqual({ driveId: 7 });
});

it("wraps the command's refusal of an offline drive", async () => {
  mockIPC(() => {
    throw { code: "not_found", message: "drive is offline" };
  });
  await expect(checkSidecarFiles(7)).rejects.toBeInstanceOf(ApiError);
});
