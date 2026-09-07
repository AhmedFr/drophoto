import type { TagCard } from "@/lib/api/tags";

export type AlbumCardProps = {
  card: TagCard;
  /** Opens this tag filtered into the gallery. */
  onOpen: () => void;
  onRename: () => void;
  onMerge: () => void;
  onDelete: () => void;
};
