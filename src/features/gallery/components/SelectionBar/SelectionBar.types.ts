export type SelectionBarProps = {
  count: number;
  /** Number of items currently loaded (paging is infinite, so this is not necessarily the library's full count) — shown alongside `count` and passed to `onSelectAll`. */
  total: number;
  onTag: () => void;
  onPlace: () => void;
  onClear: () => void;
  /** Selects every loaded item (mirrors ⌘A). */
  onSelectAll: () => void;
  /** Selects the complement of the current selection within the loaded items. */
  onInvert: () => void;
};
