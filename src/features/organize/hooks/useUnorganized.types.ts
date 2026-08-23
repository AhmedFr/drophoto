import type { Drive } from "@/lib/api/drives";
import type { UnorganizedSummary } from "@/lib/api/organize";

export type UnorganizedRow = UnorganizedSummary & { drive: Drive };

export type UseUnorganizedResult = {
  rows: UnorganizedRow[];
  /** Media already organized on this drive, skipped from the counts above. */
  organizedCount: number;
  isLoading: boolean;
  isError: boolean;
  scan: (driveId: number) => void;
  /** The drive currently being scanned via `scan`, if any. */
  scanningDriveId: number | null;
  /**
   * The most recent `scan` failure, and the drive it was for — so the
   * row that triggered it can show why nothing happened, instead of the
   * button silently reverting from "SCANNING…".
   */
  scanError: { driveId: number; message: string } | null;
};
