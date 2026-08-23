import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { vi } from "vitest";
import type { OrganizeItemRow, OrganizeJobRow } from "@/lib/api/organize";
import { useDoneSummary } from "./useDoneSummary";

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function job(overrides: Partial<OrganizeJobRow>): OrganizeJobRow {
  return {
    id: 1,
    drive_id: 1,
    drive_name: "Kodachrome",
    status: "done",
    planned: 1,
    moved: 1,
    skipped: 0,
    failed: 0,
    started_at: "2026-08-22T00:00:00Z",
    finished_at: "2026-08-22T00:01:00Z",
    kind: "organize",
    reverts_job_id: null,
    reverted_by_job_id: null,
    ...overrides,
  };
}

function item(overrides: Partial<OrganizeItemRow>): OrganizeItemRow {
  return {
    id: 1,
    job_id: 1,
    media_id: 1,
    old_rel_path: "DCIM/IMG_0001.jpg",
    new_rel_path: "archive/2024/Q2/2024-06-15_IMG_0001.jpg",
    status: "moved",
    error: null,
    ...overrides,
  };
}

function render(driveIds: number[], enabled: boolean) {
  const queryClient = new QueryClient();
  return renderHook(() => useDoneSummary(driveIds, enabled), { wrapper: wrapperFor(queryClient) });
}

it("is disabled (no fetch, empty folders) until enabled", () => {
  const listJobsSpy = vi.fn();
  mockIPC((cmd) => (cmd === "list_jobs" ? listJobsSpy() : undefined));

  const { result } = render([1], false);
  expect(result.current.folders).toEqual([]);
  expect(result.current.jobIds).toEqual([]);
  expect(listJobsSpy).not.toHaveBeenCalled();
});

it("resolves distinct destination folders of moved items for the run's drives, picking the latest job per drive", async () => {
  mockIPC((cmd, args) => {
    if (cmd === "list_jobs") {
      return [
        job({ id: 10, drive_id: 1 }),
        job({ id: 5, drive_id: 1 }), // an older job for the same drive — must be ignored
        job({ id: 20, drive_id: 2 }),
        job({ id: 30, drive_id: 99 }), // a drive not in this run — must be ignored
      ];
    }
    if (cmd === "list_job_items") {
      const jobId = (args as { jobId: number }).jobId;
      if (jobId === 10) return [item({ job_id: 10, new_rel_path: "archive/2024/Q2/a.jpg" })];
      if (jobId === 20) return [item({ job_id: 20, new_rel_path: "archive/2024/Q3/b.jpg" })];
      return [];
    }
    return undefined;
  });

  const { result } = render([1, 2], true);
  await waitFor(() => expect(result.current.folders).toEqual(["archive/2024/Q3", "archive/2024/Q2"]));
  expect(result.current.isLoading).toBe(false);
  expect(result.current.jobIds.sort()).toEqual([10, 20]);
});

it("excludes items that weren't actually moved", async () => {
  mockIPC((cmd, args) => {
    if (cmd === "list_jobs") return [job({ id: 1, drive_id: 1 })];
    if (cmd === "list_job_items" && (args as { jobId: number }).jobId === 1) {
      return [
        item({ new_rel_path: "archive/moved/a.jpg", status: "moved" }),
        item({ new_rel_path: "archive/failed/b.jpg", status: "failed" }),
        item({ new_rel_path: "archive/skipped/c.jpg", status: "skipped_dup" }),
      ];
    }
    return undefined;
  });

  const { result } = render([1], true);
  await waitFor(() => expect(result.current.folders).toEqual(["archive/moved"]));
});

it("caps the result at 3 folders", async () => {
  mockIPC((cmd, args) => {
    if (cmd === "list_jobs") return [job({ id: 1, drive_id: 1 })];
    if (cmd === "list_job_items" && (args as { jobId: number }).jobId === 1) {
      return [
        item({ new_rel_path: "archive/2024/Q1/a.jpg" }),
        item({ new_rel_path: "archive/2024/Q2/b.jpg" }),
        item({ new_rel_path: "archive/2024/Q3/c.jpg" }),
        item({ new_rel_path: "archive/2024/Q4/d.jpg" }),
      ];
    }
    return undefined;
  });

  const { result } = render([1], true);
  await waitFor(() => expect(result.current.folders).toHaveLength(3));
});

// `list_jobs` returns revert rows too, on the same drive and with a
// *higher* id than the organize job they undo. Picking the highest id
// without filtering by kind resolved the revert's own id as "this
// run's job", so the Done overlay offered to revert the revert.
it("ignores revert jobs when resolving this run's job id", async () => {
  mockIPC((cmd, args) => {
    if (cmd === "list_jobs") {
      return [
        job({ id: 9, drive_id: 1, kind: "revert", reverts_job_id: 7 }),
        job({ id: 7, drive_id: 1, kind: "organize" }),
      ];
    }
    if (cmd === "list_job_items") {
      const jobId = (args as { jobId: number }).jobId;
      return jobId === 7 ? [item({ job_id: 7 })] : [];
    }
    return undefined;
  });

  const { result } = render([1], true);

  await waitFor(() => expect(result.current.jobIds).toEqual([7]));
  expect(result.current.folders).toEqual(["archive/2024/Q2"]);
});
