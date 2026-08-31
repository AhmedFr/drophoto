import { mockIPC } from "@tauri-apps/api/mocks";
import { startScan, cancelJob } from "./scan";
import { ApiError } from "./client";

it("starts an incremental scan by default", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "start_scan") {
      received = args;
      return "scan-0";
    }
    return undefined;
  });
  await expect(startScan(1)).resolves.toBe("scan-0");
  expect(received).toEqual({ driveId: 1, full: false });
});

it("starts a full rescan when full is passed", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "start_scan") {
      received = args;
      return "scan-0";
    }
    return undefined;
  });
  await expect(startScan(1, true)).resolves.toBe("scan-0");
  expect(received).toEqual({ driveId: 1, full: true });
});

it("wraps structured errors from start_scan", async () => {
  mockIPC(() => {
    throw { code: "not_found", message: "drive is offline" };
  });
  await expect(startScan(1)).rejects.toBeInstanceOf(ApiError);
});

it("cancels a job by id", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "cancel_job") {
      received = args;
      return null;
    }
    return undefined;
  });
  await cancelJob("scan-0");
  expect(received).toEqual({ jobId: "scan-0" });
});
