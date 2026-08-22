import type { OrganizePlan } from "@/lib/api/organize";
import type { UseRuleResult } from "../../hooks/useRule.types";

export type OrganizeStepProps = {
  plan: OrganizePlan | undefined;
  isPlanning: boolean;
  rule: UseRuleResult;
};
