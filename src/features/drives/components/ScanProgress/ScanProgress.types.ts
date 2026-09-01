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
};
