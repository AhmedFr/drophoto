import type { PlanGroup } from "@/lib/organize/groupPlan";

export type PlanPreviewProps = {
  groups: PlanGroup[];
  skippedDup: number;
  /** True when there's nothing left to organize (no planned moves at all). */
  inPlace: boolean;
};
