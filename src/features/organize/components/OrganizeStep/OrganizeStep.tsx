import { groupPlan } from "@/lib/organize/groupPlan";
import { PlanPreview } from "../PlanPreview";
import { RuleEditor } from "../RuleEditor";
import type { OrganizeStepProps } from "./OrganizeStep.types";

export function OrganizeStep({ plan, isPlanning, rule, running }: OrganizeStepProps) {
  if (isPlanning) {
    return <div className="flex-1 p-6 font-mono text-[11px] text-faint">Planning…</div>;
  }

  const groups = groupPlan(plan?.items ?? []);
  const inPlace = groups.length === 0;

  return (
    <div className="flex min-h-full">
      <PlanPreview groups={groups} skippedDup={plan?.skipped_dup ?? 0} inPlace={inPlace} />
      <div className="w-[312px] flex-none p-6">
        <RuleEditor
          rule={rule.rule}
          driveIds={rule.driveIds}
          activeDriveId={rule.activeDriveId}
          onSelectDrive={rule.setActiveDriveId}
          onChange={rule.onChange}
          onSave={rule.onSave}
          saving={rule.saving}
          error={rule.error}
          disabled={running}
        />
      </div>
    </div>
  );
}
