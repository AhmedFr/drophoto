import { mockIPC } from "@tauri-apps/api/mocks";
import { startSidecarSyncAll } from "./sidecars";
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
