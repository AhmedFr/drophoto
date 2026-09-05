import type { MediaItem } from "@/lib/api/media";

export type LightboxProps = {
  /**
   * The set being browsed, indexed by absolute position. Sparse in the
   * gallery, where rows are hydrated in chunks: `items.length` is the
   * whole set's size (what the "03 / 128" counter reports) while
   * `items[index]` may not have landed yet, which the component already
   * renders as nothing.
   */
  items: (MediaItem | undefined)[];
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
  /** Same as `onTagPanelOpenChange`, for `MetaPanel`'s single-id `PlacePanel`. */
  onPlacePanelOpenChange?: (open: boolean) => void;
};
