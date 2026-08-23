import { SourceRow } from "../SourceRow";
import type { DetectStepProps } from "./DetectStep.types";

export function DetectStep({
  summaries,
  selected,
  onToggle,
  onScan,
  organizedCount,
  scanningDriveId,
  scanError,
}: DetectStepProps) {
  const selectedSummaries = summaries.filter((s) => selected.includes(s.drive_id));
  const newPhotosFound = selectedSummaries.reduce((sum, s) => sum + s.count, 0);
  // Deliberately across *every* drive, not just selected ones — a legacy
  // row can't be organized regardless of selection, so the notice needs
  // to surface it either way.
  const legacyCount = summaries.reduce((sum, s) => sum + s.legacy, 0);

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-3 border-b border-border">
        <div className="flex flex-col gap-1.5 border-r border-border px-6 py-5">
          <span className="font-mono text-[32px] leading-none">{newPhotosFound}</span>
          <span className="font-mono text-[9px] tracking-[1.5px] text-faint">NEW PHOTOS FOUND</span>
        </div>
        <div className="flex flex-col gap-1.5 border-r border-border px-6 py-5">
          <span className="font-mono text-[32px] leading-none">{selectedSummaries.length}</span>
          <span className="font-mono text-[9px] tracking-[1.5px] text-faint">DRIVES</span>
        </div>
        <div className="flex items-center px-6 py-5 text-[13px] text-muted-foreground">
          Not yet organized. <em className="not-italic text-foreground">{organizedCount} already organized</em>{" "}
          photos are skipped.
        </div>
      </div>

      {legacyCount > 0 && (
        <div className="border-b border-border px-6 py-3 font-mono text-[10px] text-faint">
          {legacyCount} files from older scans aren&apos;t covered by a source — re-scan to include them.
        </div>
      )}

      <div className="px-6 pt-5 pb-2 font-mono text-[9px] tracking-[2px] text-faint">
        DRIVES — SELECT WHAT TO ORGANIZE
      </div>

      {summaries.length ? (
        <ul className="flex flex-col gap-2 px-6 pb-6">
          {summaries.map((s) => (
            <SourceRow
              key={s.drive_id}
              summary={s}
              selected={selected.includes(s.drive_id)}
              onToggle={() => onToggle(s.drive_id)}
              onScan={() => onScan(s.drive_id)}
              scanning={scanningDriveId === s.drive_id}
              scanError={scanError?.driveId === s.drive_id ? scanError.message : null}
            />
          ))}
        </ul>
      ) : (
        <p className="px-6 pb-6 font-mono text-[11px] text-faint">No drives online.</p>
      )}
    </div>
  );
}
