import { useWizardStore } from "./store/wizardStore";
import { useUnorganized } from "./hooks/useUnorganized";
import { StepRail } from "./components/StepRail";
import { WizardHeader } from "./components/WizardHeader";
import { WizardFooter } from "./components/WizardFooter";
import { DetectStep } from "./components/DetectStep";

export function OrganizePage() {
  const step = useWizardStore((s) => s.step);
  const selectedDriveIds = useWizardStore((s) => s.selectedDriveIds);
  const toggleDrive = useWizardStore((s) => s.toggleDrive);
  const next = useWizardStore((s) => s.next);
  const back = useWizardStore((s) => s.back);

  const { rows, organizedCount, scan, scanningDriveId } = useUnorganized();

  const selectedRows = rows.filter((r) => selectedDriveIds.includes(r.drive_id));
  const selectedCount = selectedRows.reduce((sum, r) => sum + r.count, 0);
  const selectedBytes = selectedRows.reduce((sum, r) => sum + r.bytes, 0);

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
            <WizardHeader eyebrow="STEP 02 · ORGANIZE" title="Organize" />
            <div className="flex-1 p-6 font-mono text-[11px] text-faint">
              Organize step — coming next
            </div>
          </>
        )}
        <WizardFooter
          step={step}
          totalSteps={2}
          canContinue={selectedDriveIds.length > 0}
          onBack={back}
          onContinue={next}
        />
      </div>
    </div>
  );
}
