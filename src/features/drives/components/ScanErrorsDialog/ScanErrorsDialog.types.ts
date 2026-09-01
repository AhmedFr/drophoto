import type { Drive } from "@/lib/api/drives";

export type ScanErrorsDialogProps = {
  /** The drive whose `scan_errors` to browse. `null` keeps the dialog closed. */
  drive: Drive | null;
  onClose: () => void;
};
