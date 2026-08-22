import type { JobEvent } from "@/lib/api/scan";

export type ScanProgressProps = {
  event?: JobEvent;
  onCancel: () => void;
};
