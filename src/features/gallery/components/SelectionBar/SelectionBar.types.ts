export type SelectionBarProps = {
  count: number;
  /**
   * How many items the current filter, search and sort produce — the whole
   * set the gallery is showing, not a page of it. Paging is gone: the
   * timeline index covers every match, hydrated or not, so this is a real
   * total for the current view (the library's own total only when nothing
   * is filtered).
   */
  total: number;
  onTag: () => void;
  onPlace: () => void;
  onClear: () => void;
  /** Selects every item in the current view (mirrors ⌘A). */
  onSelectAll: () => void;
  /** Selects the complement of the current selection within the current view. */
  onInvert: () => void;
};
