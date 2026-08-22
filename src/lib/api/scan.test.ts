import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import { startScan, cancelJob, onJobEvent } from "./scan";
import { ApiError } from "./client";
import type { JobEvent } from "./scan";

vi.mock("@tauri-apps/api/event");

it("starts a scan with the given drive id", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "start_scan") {
      received = args;
      return "scan-0";
    }
    return undefined;
  });
  await expect(startScan(1)).resolves.toBe("scan-0");
  expect(received).toEqual({ driveId: 1 });
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

it("subscribes to job events via listen", async () => {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = vi.fn();
  vi.mocked(listen).mockResolvedValue(unlisten);

  const cb = vi.fn();
  const result = await onJobEvent(cb);

  expect(listen).toHaveBeenCalledWith("job", expect.any(Function));
  const handler = vi.mocked(listen).mock.calls[0][1];
  const event: JobEvent = { kind: "progress", job_id: "scan-0", done: 1, total: 2, current: "a.jpg" };
  handler({ payload: event } as never);
  expect(cb).toHaveBeenCalledWith(event);
  expect(result).toBe(unlisten);
});
