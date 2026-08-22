import type { OrganizeJobRow } from "@/lib/api/organize";

export type RecentJobsProps = {
  jobs: OrganizeJobRow[];
  /** Injectable "now" (ms epoch) for deterministic relative-time tests; defaults to `Date.now()`. */
  now?: number;
};
