import type { UnorganizedRow } from "../../hooks/useUnorganized.types";

export type DetectStepProps = {
  summaries: UnorganizedRow[];
  selected: number[];
  onToggle: (driveId: number) => void;
  onScan: (driveId: number) => void;
  organizedCount: number;
  scanningDriveId?: number | null;
  /** The last scan failure, and which drive it belongs to — see
   * `UseUnorganizedResult.scanError`. Routed to that drive's row only. */
  scanError?: { driveId: number; message: string } | null;
};
