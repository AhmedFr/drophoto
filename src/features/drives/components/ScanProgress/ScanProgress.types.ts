import type { JobEvent } from "@/lib/api/scan";

export type ScanProgressProps = {
  event?: JobEvent;
  onCancel: () => void;
  /**
   * Opens `ScanErrorsDialog` for this scan's drive. When given (and the
   * terminal event reports `failed > 0`), the "N failed" readout renders
   * as a button calling this instead of plain text.
   */
  onOpenErrors?: () => void;
  /**
   * This scan's drive id — when given alongside `onOpenErrors` and a
   * `failed > 0` terminal event, the "N failed" button is wrapped in
   * `ScanErrorSeverityHoverCard`, showing the severity repartition on
   * hover before the user commits to opening the full dialog. Omitted
   * entirely (no hover card, plain button) when not given, so callers
   * that don't have a drive id handy keep working unchanged.
   */
  driveId?: number;
};
