import { mockIPC } from "@tauri-apps/api/mocks";
import { startScan, cancelJob, countScanErrors, listScanErrors, scanErrorCodeCounts } from "./scan";
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

it("counts a drive's scan errors", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "count_scan_errors") {
      received = args;
      return 3;
    }
    return undefined;
  });
  await expect(countScanErrors(1)).resolves.toBe(3);
  expect(received).toEqual({ driveId: 1 });
});

it("lists a page of a drive's scan errors", async () => {
  let received: unknown;
  const rows = [
    { id: 2, drive_id: 1, path: "b.jpg", code: "io", message: "boom", at: "2024-01-02T00:00:00Z" },
    { id: 1, drive_id: 1, path: "a.jpg", code: "stub", message: "too small", at: "2024-01-01T00:00:00Z" },
  ];
  mockIPC((cmd, args) => {
    if (cmd === "list_scan_errors") {
      received = args;
      return rows;
    }
    return undefined;
  });
  await expect(listScanErrors(1, 100, 0)).resolves.toEqual(rows);
  expect(received).toEqual({ driveId: 1, limit: 100, offset: 0 });
});

it("gets a drive's scan-error code counts", async () => {
  let received: unknown;
  const counts = [
    { code: "io", count: 5 },
    { code: "db", count: 2 },
  ];
  mockIPC((cmd, args) => {
    if (cmd === "scan_error_code_counts") {
      received = args;
      return counts;
    }
    return undefined;
  });
  await expect(scanErrorCodeCounts(1)).resolves.toEqual(counts);
  expect(received).toEqual({ driveId: 1 });
});
