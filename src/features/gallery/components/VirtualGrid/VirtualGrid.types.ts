import type { MediaItem } from "@/lib/api/media";

export type VirtualGridProps = {
  items: MediaItem[];
  targetRowHeight: number;
  onOpen: (index: number) => void;
  onNearEnd?: () => void;
};
