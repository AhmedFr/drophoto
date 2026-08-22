import type { Drive } from "@/lib/api/drives";
import type { JobEvent } from "@/lib/api/scan";

export type DriveCardProps = {
  drive: Drive;
  onScan?: () => void;
  onCancelScan?: () => void;
  scanEvent?: JobEvent;
};
