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
  /**
   * The media id expected at each position, from the same source that
   * numbered `items`. `Lightbox` shows `items[index]` only when it is
   * really `ids[index]`'s photo — a refetch can land new rows under an
   * already-open lightbox without the index moving, and displaying the
   * wrong one would also retarget `MetaPanel`'s tag and place writes.
   * Checked in here rather than at the call sites, so no caller can
   * bypass it.
   */
  ids: number[];
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
