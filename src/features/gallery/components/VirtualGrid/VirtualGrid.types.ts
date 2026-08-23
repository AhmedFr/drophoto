import type { MediaItem } from "@/lib/api/media";

export type VirtualGridProps = {
  items: MediaItem[];
  targetRowHeight: number;
  onOpen: (index: number) => void;
  onNearEnd?: () => void;
  selectedIds: Set<number>;
  /** `shiftKey` distinguishes a plain (cmd/ctrl-click) toggle from a shift-range select. */
  onToggle: (index: number, shiftKey: boolean) => void;
};
