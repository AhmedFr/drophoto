import type { Drive } from "@/lib/api/drives";

export type SourcesDialogProps = {
  drive: Drive | null;
  onClose: () => void;
};
