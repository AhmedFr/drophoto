import { mockIPC } from "@tauri-apps/api/mocks";
import {
  getRule,
  saveRule,
  listUnorganizedSummaries,
  planOrganize,
  startOrganize,
  listJobs,
  listJobItems,
} from "./organize";
import { ApiError } from "./client";
import type { OrganizeRule, OrganizePlan, UnorganizedSummary, OrganizeJobRow, OrganizeItemRow } from "./organize";

const rule: OrganizeRule = {
  drive_id: 1,
  root: "archive",
  folder_tpl: "{{yyyy}}/Q{{q}}",
  file_tpl: "{{yyyy}}-{{mm}}-{{dd}}_{{stem}}",
  keep_pairs: true,
};

const plan: OrganizePlan = {
  items: [
    {
      media_id: 1,
      old_rel_path: "a.jpg",
      new_rel_path: "archive/2025/Q3/2025-09-12_a.jpg",
      status: "planned",
      reason: null,
    },
  ],
  planned: 1,
  skipped_dup: 0,
  bytes: 1234,
};

const summary: UnorganizedSummary = {
  drive_id: 1,
  count: 3,
  bytes: 3000,
  photos: 2,
  videos: 1,
  earliest: "2025-09-01T00:00:00Z",
  latest: "2025-09-12T00:00:00Z",
};

const jobRow: OrganizeJobRow = {
  id: 1,
  drive_id: 1,
  drive_name: "Kodachrome",
  status: "done",
  planned: 3,
  moved: 2,
  skipped: 1,
  failed: 0,
  started_at: "2026-08-22T00:00:00Z",
  finished_at: "2026-08-22T00:00:05Z",
};

const itemRow: OrganizeItemRow = {
  id: 1,
  job_id: 1,
  media_id: 1,
  old_rel_path: "a.jpg",
  new_rel_path: "archive/2025/Q3/2025-09-12_a.jpg",
  status: "moved",
  error: null,
};

it("gets the rule for a drive", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "get_rule") {
      received = args;
      return rule;
    }
    return undefined;
  });
  await expect(getRule(1)).resolves.toEqual(rule);
  expect(received).toEqual({ driveId: 1 });
});

it("saves a rule", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "save_rule") {
      received = args;
      return null;
    }
    return undefined;
  });
  await saveRule(rule);
  expect(received).toEqual({ rule });
});

it("wraps structured errors from save_rule", async () => {
  mockIPC(() => {
    throw { code: "unsupported", message: "unknown template variable" };
  });
  await expect(saveRule(rule)).rejects.toBeInstanceOf(ApiError);
});

it("lists unorganized summaries", async () => {
  mockIPC((cmd) => (cmd === "list_unorganized_summaries" ? [summary] : undefined));
  await expect(listUnorganizedSummaries()).resolves.toEqual([summary]);
});

it("plans organize for the given drive ids", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "plan_organize") {
      received = args;
      return plan;
    }
    return undefined;
  });
  await expect(planOrganize([1, 2])).resolves.toEqual(plan);
  expect(received).toEqual({ driveIds: [1, 2] });
});

it("starts an organize job for a drive", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "start_organize") {
      received = args;
      return "organize-0";
    }
    return undefined;
  });
  await expect(startOrganize(1)).resolves.toBe("organize-0");
  expect(received).toEqual({ driveId: 1 });
});

it("lists jobs with a limit", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_jobs") {
      received = args;
      return [jobRow];
    }
    return undefined;
  });
  await expect(listJobs(10)).resolves.toEqual([jobRow]);
  expect(received).toEqual({ limit: 10 });
});

it("lists job items with a limit", async () => {
  let received: unknown;
  mockIPC((cmd, args) => {
    if (cmd === "list_job_items") {
      received = args;
      return [itemRow];
    }
    return undefined;
  });
  await expect(listJobItems(1, 10)).resolves.toEqual([itemRow]);
  expect(received).toEqual({ jobId: 1, limit: 10 });
});
