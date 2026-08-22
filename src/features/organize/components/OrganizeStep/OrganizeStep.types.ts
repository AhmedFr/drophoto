import type { OrganizePlan } from "@/lib/api/organize";
import type { UseRuleResult } from "../../hooks/useRule.types";

export type OrganizeStepProps = {
  plan: OrganizePlan | undefined;
  isPlanning: boolean;
  rule: UseRuleResult;
  /** Online drives (id + name), so the rule editor's drive selector can label its options. */
  drives: { id: number; name: string }[];
  /** True while an organize run is in progress — disables the RuleEditor's inputs and SAVE. */
  running: boolean;
};
