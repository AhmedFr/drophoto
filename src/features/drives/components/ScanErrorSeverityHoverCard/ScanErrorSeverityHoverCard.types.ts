import type { ReactNode } from "react";

export type ScanErrorSeverityHoverCardProps = {
  /** The drive whose `scan_errors` severity repartition to show. */
  driveId: number;
  /** The trigger element — `ScanProgress`'s "N failed" button. */
  children: ReactNode;
};
