import { invokeApi } from "./client";

export type OrganizeRule = {
  drive_id: number;
  root: string;
  folder_tpl: string;
  file_tpl: string;
  keep_pairs: boolean;
};

/**
 * Settings-backed defaults for a fresh drive's organize rule — mirrors
 * `dp_core::OrganizeDefaults`. Each field independently `null` means
 * "never configured"; `get_rule`'s fallback composes each unset field
 * from `ORGANIZE_RULE_FALLBACK` instead.
 */
export type OrganizeDefaults = {
  root: string | null;
  folder_tpl: string | null;
  file_tpl: string | null;
  keep_pairs: boolean | null;
};

/**
 * The hardcoded organize-rule fallback for a drive with no saved rule and
 * no settings-backed default — mirrors `dp_core::OrganizeRule::default_for`.
 * Used to prefill Settings' `OrganizeDefaultsSection` inputs for any field
 * `get_organize_defaults` reports as unset.
 */
export const ORGANIZE_RULE_FALLBACK = {
  root: "archive",
  folder_tpl: "{{yyyy}}/Q{{q}}",
  file_tpl: "{{yyyy}}-{{mm}}-{{dd}}_{{stem}}",
  keep_pairs: true,
} as const;

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
  /**
   * Media rows on this drive never attributed to a source — scanned
   * before sources existed. These can't be organized (the planner
   * requires a source) and are already excluded from `count`; a re-scan
   * is what attributes them to a source and makes them organizable.
   */
  legacy: number;
  /**
   * Whether this drive has at least one *enabled* source configured.
   * `false` means a scan would walk nothing at all, so the UI must offer
   * to set sources up instead of offering a scan that can only ever find
   * zero photos.
   */
  has_sources: boolean;
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
  /** `organize` | `revert` */
  kind: string;
  /** For a `revert` job: the `organize_jobs.id` it reverts. */
  reverts_job_id: number | null;
  /**
   * For an `organize` job: the id of the newest `revert` job that
   * reverts it, if any. `null` for a `revert` job, or an `organize` job
   * never reverted.
   */
  reverted_by_job_id: number | null;
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

/** Current settings-backed organize-rule defaults. */
export const getOrganizeDefaults = () => invokeApi<OrganizeDefaults>("get_organize_defaults");

/**
 * Persists the settings-backed organize-rule defaults. Every configured
 * (non-`null`) field is validated the same way `saveRule` validates a
 * drive's own rule — rejected (`ApiError`, code `"unsupported"`) for a
 * bad root or an unknown/malformed template variable.
 */
export const saveOrganizeDefaults = (defaults: OrganizeDefaults) =>
  invokeApi<void>("set_organize_defaults", { defaults });

export const listUnorganizedSummaries = () =>
  invokeApi<UnorganizedSummary[]>("list_unorganized_summaries");

export const planOrganize = (driveIds: number[]) =>
  invokeApi<OrganizePlan>("plan_organize", { driveIds });

export const startOrganize = (driveId: number) => invokeApi<string>("start_organize", { driveId });

export const listJobs = (limit: number) => invokeApi<OrganizeJobRow[]>("list_jobs", { limit });

export const listJobItems = (jobId: number, limit: number) =>
  invokeApi<OrganizeItemRow[]>("list_job_items", { jobId, limit });

export const revertOrganize = (jobId: number) => invokeApi<string>("revert_organize", { jobId });
