import type { Tag } from "@/lib/api/tags";

export type MergeTagDialogProps = {
  /** The tag being merged away. `null` keeps the dialog closed. */
  tag: Tag | null;
  /** Every tag, for the merge-target picker — `tag` itself is filtered out. */
  allTags: Tag[];
  onClose: () => void;
};
