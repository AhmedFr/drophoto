import type { Drive } from "@/lib/api/drives";
import type { JobEvent } from "@/lib/api/scan";
import type { Source } from "@/lib/api/sources";

export type DriveCardProps = {
  drive: Drive;
  /** This drive's configured sources, used for the "N sources" label and
   * to decide whether Scan is allowed. Defaults to `[]` (shown as "No
   * sources", Scan disabled) while the caller's sources query loads. */
  sources?: Source[];
  onScan?: () => void;
  onCancelScan?: () => void;
  onOpenSources?: () => void;
  scanEvent?: JobEvent;
};
