import { invokeApi } from "./client";

export type OrganizeRule = {
  drive_id: number;
  root: string;
  folder_tpl: string;
  file_tpl: string;
  keep_pairs: boolean;
};

export type PlanStatus = "planned" | "moved" | "skipped_dup" | "skipped_collision" | "failed";

export type OrganizePlanItem = {
  media_id: number;
  old_rel_path: string;
  new_rel_path: string;
  status: PlanStatus;
  reason: string | null;
};

export type OrganizePlan = {
  items: OrganizePlanItem[];
  planned: number;
  skipped_dup: number;
  bytes: number;
};

export type UnorganizedSummary = {
  drive_id: number;
  /** Media still waiting to be organized under the rule's root. */
  count: number;
  /**
   * Every media row known for this drive, organized or not. `0` is the
   * only reliable "never scanned" signal — a `count` of `0` on its own
   * just as easily means "everything here is already organized".
   */
  total: number;
  bytes: number;
  photos: number;
  videos: number;
  earliest: string | null;
  latest: string | null;
};

export type OrganizeJobRow = {
  id: number;
  drive_id: number;
  drive_name: string;
  /** `running` | `done` | `cancelled` | `failed` */
  status: string;
  planned: number;
  moved: number;
  skipped: number;
  failed: number;
  started_at: string;
  finished_at: string | null;
};

export type OrganizeItemRow = {
  id: number;
  job_id: number;
  media_id: number;
  old_rel_path: string;
  new_rel_path: string;
  status: PlanStatus;
  error: string | null;
};

export const getRule = (driveId: number) => invokeApi<OrganizeRule>("get_rule", { driveId });

export const saveRule = (rule: OrganizeRule) => invokeApi<void>("save_rule", { rule });

export const listUnorganizedSummaries = () =>
  invokeApi<UnorganizedSummary[]>("list_unorganized_summaries");

export const planOrganize = (driveIds: number[]) =>
  invokeApi<OrganizePlan>("plan_organize", { driveIds });

export const startOrganize = (driveId: number) => invokeApi<string>("start_organize", { driveId });

export const listJobs = (limit: number) => invokeApi<OrganizeJobRow[]>("list_jobs", { limit });

export const listJobItems = (jobId: number, limit: number) =>
  invokeApi<OrganizeItemRow[]>("list_job_items", { jobId, limit });
