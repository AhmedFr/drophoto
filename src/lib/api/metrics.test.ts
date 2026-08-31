import { mockIPC } from "@tauri-apps/api/mocks";
import { listJobRuns } from "./metrics";
import type { JobRun } from "./metrics";

const run: JobRun = {
  id: 1,
  job_id: "scan-3",
  kind: "scan",
  drive_id: 7,
  status: "done",
  ok: 100,
  failed: 2,
  skipped: 5,
  bytes_read: 1_000_000,
  bytes_written: 200_000,
  cpu_ms: 4200,
  started_at: "2026-01-01T10:00:00Z",
  finished_at: "2026-01-01T10:05:00Z",
};

it("lists job runs with the given limit", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_job_runs") {
      received = args;
      return [run];
    }
    return undefined;
  });
  await expect(listJobRuns(8)).resolves.toEqual([run]);
  expect(received).toEqual({ limit: 8 });
});

it("defaults the limit to 20", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_job_runs") {
      received = args;
      return [];
    }
    return undefined;
  });
  await listJobRuns();
  expect(received).toEqual({ limit: 20 });
});
