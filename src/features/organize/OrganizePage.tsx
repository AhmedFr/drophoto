import { useEffect } from "react";
import { useWizardStore } from "./store/wizardStore";
import { useUnorganized } from "./hooks/useUnorganized";
import { usePlan } from "./hooks/usePlan";
import { useRule } from "./hooks/useRule";
import { useOrganizeRun } from "./hooks/useOrganizeRun";
import { useDoneSummary } from "./hooks/useDoneSummary";
import { StepRail } from "./components/StepRail";
import { WizardHeader } from "./components/WizardHeader";
import { WizardFooter } from "./components/WizardFooter";
import { DetectStep } from "./components/DetectStep";
import { OrganizeStep } from "./components/OrganizeStep";
import { DoneOverlay } from "./components/DoneOverlay";
import { groupPlan } from "@/lib/organize/groupPlan";

export function OrganizePage() {
  const step = useWizardStore((s) => s.step);
  const selectedDriveIds = useWizardStore((s) => s.selectedDriveIds);
  const toggleDrive = useWizardStore((s) => s.toggleDrive);
  const next = useWizardStore((s) => s.next);
  const back = useWizardStore((s) => s.back);

  const { rows, organizedCount, scan, scanningDriveId } = useUnorganized();

  const planQuery = usePlan(selectedDriveIds);
  const rule = useRule(selectedDriveIds);
  const run = useOrganizeRun(selectedDriveIds);
  const doneSummary = useDoneSummary(selectedDriveIds, run.done);

  // The wizard is deliberately not persisted (see `wizardStore.ts`), but
  // nothing previously reset it back to step 0 with no selection once a
  // run finished — leaving a stale in-progress-looking wizard behind if
  // the user ever came back to /organize without a full app reload.
  // `DoneOverlay`'s own CTAs reset on click (before navigating); this
  // covers unmounting by any other route (e.g. the app's nav) while done.
  useEffect(() => {
    return () => {
      if (run.done) useWizardStore.getState().reset();
    };
  }, [run.done]);

  const selectedRows = rows.filter((r) => selectedDriveIds.includes(r.drive_id));
  const selectedCount = selectedRows.reduce((sum, r) => sum + r.count, 0);
  const selectedBytes = selectedRows.reduce((sum, r) => sum + r.bytes, 0);

  const planned = planQuery.data?.planned ?? 0;
  const planGroups = groupPlan(planQuery.data?.items ?? []);

  // Once the real per-item result has loaded, prefer it — it reflects
  // what actually happened (collision suffixes, partial failures), not
  // just what was planned. Fall back to the pre-run plan's folders (with
  // a hint noting so) for the brief window before it's ready.
  const doneFolders = doneSummary.isLoading ? planGroups.map((g) => g.folder).slice(0, 3) : doneSummary.folders;
  const doneFoldersHint = doneSummary.isLoading ? "from the plan" : null;

  const primaryLabel =
    step === 0 ? "CONTINUE →" : rule.isDirty ? "SAVE RULE FIRST" : `ORGANIZE ${planned} →`;
  const primaryDisabled =
    step === 0
      ? selectedDriveIds.length === 0
      : rule.isDirty || planQuery.isLoading || planned === 0 || run.running || run.done;
  const hint = step === 1 && rule.isDirty && !run.running ? "Save the rule to apply your changes" : null;

  return (
    <div className="flex h-full">
      <StepRail step={step} selectedCount={selectedCount} selectedBytes={selectedBytes} />
      <div className="flex min-w-0 flex-1 flex-col">
        {step === 0 ? (
          <>
            <WizardHeader
              eyebrow="STEP 01 · DETECT"
              title="New photos found"
              note="Select the drives you'd like to organize. Nothing leaves this computer."
            />
            <div className="flex-1 overflow-y-auto">
              <DetectStep
                summaries={rows}
                selected={selectedDriveIds}
                onToggle={toggleDrive}
                onScan={scan}
                organizedCount={organizedCount}
                scanningDriveId={scanningDriveId}
              />
            </div>
          </>
        ) : (
          <>
            <WizardHeader
              eyebrow="STEP 02 · ORGANIZE"
              title="Rename & file"
              note="Review the portable filename and folder structure before anything moves."
            />
            <div className="flex-1 overflow-y-auto">
              <OrganizeStep
                plan={planQuery.data}
                isPlanning={planQuery.isLoading}
                rule={rule}
                running={run.running}
              />
            </div>
          </>
        )}
        <WizardFooter
          step={step}
          totalSteps={2}
          onBack={back}
          primaryLabel={primaryLabel}
          primaryDisabled={primaryDisabled}
          onPrimary={step === 0 ? next : run.start}
          running={run.running ? { done: run.progress?.done ?? 0, total: run.progress?.total ?? 0, onCancel: run.cancel } : null}
          error={step === 1 ? run.error : null}
          hint={hint}
        />
      </div>
      {run.done && (
        <DoneOverlay
          moved={run.totals.moved}
          skipped={run.totals.skipped + (planQuery.data?.skipped_dup ?? 0)}
          failed={run.totals.failed}
          fileTpl={rule.rule?.file_tpl ?? ""}
          folders={doneFolders}
          foldersHint={doneFoldersHint}
        />
      )}
    </div>
  );
}
