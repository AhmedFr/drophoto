import type { UnorganizedRow } from "../../hooks/useUnorganized.types";

export type DetectStepProps = {
  summaries: UnorganizedRow[];
  selected: number[];
  onToggle: (driveId: number) => void;
  onScan: (driveId: number) => void;
  organizedCount: number;
  scanningDriveId?: number | null;
};
