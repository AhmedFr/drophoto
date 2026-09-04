import type { TagWithCount } from "@/lib/api/tags";

export type DeleteTagDialogProps = {
  /** The tag being deleted, with its current photo count. `null` keeps the dialog closed. */
  tagWithCount: TagWithCount | null;
  onClose: () => void;
};
