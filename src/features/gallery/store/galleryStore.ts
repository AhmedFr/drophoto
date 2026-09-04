import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MediaQuery, MediaSort } from "@/lib/api/media";
import { TYPE_FILTERS, typeFilterToQuery, type TypeFilter } from "@/lib/media/typeFilter";

export type SortOption = "NEWEST" | "OLDEST" | "ADDED";
export type Density = "Comfortable" | "Compact" | "Dense";

export const SORT_TO_QUERY: Record<SortOption, MediaSort> = {
  NEWEST: "taken_desc",
  OLDEST: "taken_asc",
  ADDED: "added_desc",
};

export const DEFAULT_SORT: SortOption = "NEWEST";

export const DENSITY_ROW_HEIGHT: Record<Density, number> = {
  Comfortable: 240,
  Compact: 180,
  Dense: 130,
};

type GalleryState = {
  typeFilter: TypeFilter;
  sort: SortOption;
  density: Density;
  setTypeFilter: (typeFilter: TypeFilter) => void;
  setSort: (sort: SortOption) => void;
  setDensity: (density: Density) => void;
  /** Selected media ids, insertion-ordered. Not persisted — see `partialize`. */
  selectedIds: number[];
  /** Index (in the loaded items array) of the last plainly-toggled tile, used as the shift-range anchor. Not persisted. */
  anchorIndex: number | null;
  /**
   * Roving keyboard focus: the index (in the loaded items array) of the
   * tile GalleryPage's grid-level Left/Right/Up/Down/Space/Enter handling
   * currently targets. Distinct from real DOM focus/`anchorIndex` — a tile
   * can be keyboard-"focused" without being selected or anchoring a range.
   * Not persisted: an ephemeral navigation cursor, not a preference.
   */
  focusIndex: number | null;
  setFocusIndex: (index: number | null) => void;
  /**
   * Sets the shift-range anchor without toggling any item's membership.
   * `toggleSelected` already moves the anchor as a side effect of a plain
   * click, but keyboard Shift+Arrow needs to (re-)establish an anchor on
   * the path where focus moved via a plain Arrow key — no click ever
   * happened, so nothing already set one.
   */
  setAnchorIndex: (index: number | null) => void;
  /** Plain (cmd/ctrl-click) toggle: flips `id`'s membership and sets it as the new anchor. */
  toggleSelected: (id: number, index: number) => void;
  /** Shift-range select: adds `ids` to the selection without clearing it or moving the anchor. */
  selectRange: (ids: number[]) => void;
  /**
   * Removes `ids` from the selection, leaving everything else (and the
   * anchor) untouched — the inverse of `selectRange`, used by keyboard
   * Shift+Arrow to shrink a range back toward the anchor as focus retreats.
   */
  deselectRange: (ids: number[]) => void;
  /**
   * Replaces the selection outright with `ids` (deduped) — used by ⌘A
   * ("select all loaded") and a plain (non-additive) month-header click
   * ("select just this section"). Clears the anchor: `ids` isn't
   * necessarily a single contiguous run in the loaded-items array (e.g.
   * under an ADDED sort a month's ids can be non-consecutive), so there's
   * no one meaningful shift-range start to keep.
   */
  selectAll: (ids: number[]) => void;
  /**
   * Replaces the selection with its complement within `allIds` (the
   * currently loaded items) — SelectionBar's INVERT action. Clears the
   * anchor, same reasoning as `selectAll`.
   */
  invertSelection: (allIds: number[]) => void;
  clearSelection: () => void;
  /** Whether the grid is currently restricted to missing media — toggled by the toolbar's "Missing (N)" chip. Not persisted: a view mode, not a durable preference. */
  missingOnly: boolean;
  setMissingOnly: (missingOnly: boolean) => void;
  /** The toolbar search box's raw (untrimmed) text. Not persisted — a live view filter, not a durable preference, same reasoning as `missingOnly`. */
  query: string;
  setQuery: (query: string) => void;
  /**
   * The active tag filter, set by the Tags page's "navigate to this tag's
   * photos" action (a store setter, chosen over route state as the
   * simpler of the two options the brief allows — see `TagsPage`). Not
   * persisted: a live view filter, not a durable preference, same
   * reasoning as `missingOnly`/`query`.
   */
  tagId: number | null;
  setTagId: (tagId: number | null) => void;
};

const DEFAULTS = {
  typeFilter: "ALL" as TypeFilter,
  sort: DEFAULT_SORT,
  density: "Comfortable" as Density,
  selectedIds: [] as number[],
  anchorIndex: null as number | null,
  focusIndex: null as number | null,
  missingOnly: false,
  query: "",
  tagId: null as number | null,
};

type PersistedGalleryState = Partial<Pick<GalleryState, "typeFilter" | "sort" | "density">>;

/**
 * Keeps only persisted values that are still valid members of their
 * respective enums, falling back to defaults for anything unrecognized
 * (e.g. hand-edited or stale `localStorage`, or a value from a removed
 * option).
 */
function sanitize(persisted: unknown): PersistedGalleryState {
  const p = (persisted ?? {}) as PersistedGalleryState;
  return {
    typeFilter: TYPE_FILTERS.includes(p.typeFilter as TypeFilter) ? p.typeFilter : DEFAULTS.typeFilter,
    sort: Object.keys(SORT_TO_QUERY).includes(p.sort as string) ? p.sort : DEFAULTS.sort,
    density: Object.keys(DENSITY_ROW_HEIGHT).includes(p.density as string)
      ? p.density
      : DEFAULTS.density,
  };
}

export const useGalleryStore = create<GalleryState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      // Changing the filter or sort can drop ids out of the visible list —
      // a still-selected id whose tile is no longer shown would be an
      // invisible tag-target, so the selection is cleared whenever the
      // value actually changes (a no-op set, e.g. re-picking the current
      // filter, leaves it alone).
      setTypeFilter: (typeFilter) =>
        set((state) =>
          state.typeFilter === typeFilter
            ? { typeFilter }
            : { typeFilter, selectedIds: [], anchorIndex: null, focusIndex: null },
        ),
      setSort: (sort) =>
        set((state) =>
          state.sort === sort
            ? { sort }
            : { sort, selectedIds: [], anchorIndex: null, focusIndex: null },
        ),
      setDensity: (density) => set({ density }),
      setFocusIndex: (focusIndex) => set({ focusIndex }),
      setAnchorIndex: (anchorIndex) => set({ anchorIndex }),
      toggleSelected: (id, index) =>
        set((state) => ({
          selectedIds: state.selectedIds.includes(id)
            ? state.selectedIds.filter((selectedId) => selectedId !== id)
            : [...state.selectedIds, id],
          anchorIndex: index,
        })),
      selectRange: (ids) =>
        set((state) => {
          const existing = new Set(state.selectedIds);
          const toAdd = ids.filter((id) => !existing.has(id));
          return { selectedIds: [...state.selectedIds, ...toAdd] };
        }),
      deselectRange: (ids) =>
        set((state) => {
          const toRemove = new Set(ids);
          return { selectedIds: state.selectedIds.filter((id) => !toRemove.has(id)) };
        }),
      selectAll: (ids) => set({ selectedIds: Array.from(new Set(ids)), anchorIndex: null }),
      invertSelection: (allIds) =>
        set((state) => {
          const selected = new Set(state.selectedIds);
          return { selectedIds: allIds.filter((id) => !selected.has(id)), anchorIndex: null };
        }),
      clearSelection: () => set({ selectedIds: [], anchorIndex: null }),
      // Same reasoning as `setTypeFilter`/`setSort`: switching in or out of
      // the missing-only view changes which tiles are visible, so a
      // still-selected id whose tile just disappeared can't stay an
      // invisible tag-target.
      setMissingOnly: (missingOnly) =>
        set((state) =>
          state.missingOnly === missingOnly
            ? { missingOnly }
            : { missingOnly, selectedIds: [], anchorIndex: null, focusIndex: null },
        ),
      // Same reasoning as `setTypeFilter`/`setSort`/`setMissingOnly`: a
      // query change can drop ids out of the visible list.
      setQuery: (query) =>
        set((state) =>
          state.query === query
            ? { query }
            : { query, selectedIds: [], anchorIndex: null, focusIndex: null },
        ),
      // Same reasoning as `setTypeFilter`/`setSort`/`setMissingOnly`/
      // `setQuery`: switching (or clearing) the tag filter changes which
      // tiles are visible.
      setTagId: (tagId) =>
        set((state) =>
          state.tagId === tagId
            ? { tagId }
            : { tagId, selectedIds: [], anchorIndex: null, focusIndex: null },
        ),
    }),
    {
      name: "drophoto.gallery",
      version: 1,
      partialize: (s) => ({ typeFilter: s.typeFilter, sort: s.sort, density: s.density }),
      merge: (persisted, current) => ({ ...current, ...sanitize(persisted) }),
    },
  ),
);

export function buildQuery(
  s: {
    typeFilter: TypeFilter;
    sort: SortOption;
    missingOnly?: boolean;
    query?: string;
    tagId?: number | null;
  },
  limit: number,
  offset: number,
): MediaQuery {
  return {
    ...typeFilterToQuery(s.typeFilter),
    sort: SORT_TO_QUERY[s.sort],
    limit,
    offset,
    missing: s.missingOnly ?? false,
    query: s.query?.trim() || undefined,
    tag_ids: s.tagId != null ? [s.tagId] : undefined,
  };
}
