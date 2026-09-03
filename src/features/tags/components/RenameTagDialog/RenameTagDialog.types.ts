import type { Tag } from "@/lib/api/tags";

export type RenameTagDialogProps = {
  /** The tag being renamed. `null` keeps the dialog closed. */
  tag: Tag | null;
  onClose: () => void;
};
