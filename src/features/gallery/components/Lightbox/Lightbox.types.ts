import type { MediaItem } from "@/lib/api/media";

export type LightboxProps = {
  items: MediaItem[];
  index: number;
  onClose(): void;
  onPrev(): void;
  onNext(): void;
  /**
   * Forwarded to `MetaPanel`'s own (single-id) `TagPanel` open state, so
   * `GalleryPage` can tell its document-level Escape handler to yield to
   * Radix (closing just that nested dialog) instead of clearing the
   * background selection. Optional since most `Lightbox` tests don't care.
   */
  onTagPanelOpenChange?: (open: boolean) => void;
};
