import type { TagWithCount } from "@/lib/api/tags";

export type TagRowProps = {
  tagWithCount: TagWithCount;
  /** Clicking the tag name — navigates to the gallery filtered by this tag. */
  onOpen: (tagId: number) => void;
  onRename: (tagWithCount: TagWithCount) => void;
  onMerge: (tagWithCount: TagWithCount) => void;
  onDelete: (tagWithCount: TagWithCount) => void;
};
