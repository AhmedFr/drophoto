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
  /** Plain (cmd/ctrl-click) toggle: flips `id`'s membership and sets it as the new anchor. */
  toggleSelected: (id: number, index: number) => void;
  /** Shift-range select: adds `ids` to the selection without clearing it or moving the anchor. */
  selectRange: (ids: number[]) => void;
  clearSelection: () => void;
};

const DEFAULTS = {
  typeFilter: "ALL" as TypeFilter,
  sort: DEFAULT_SORT,
  density: "Comfortable" as Density,
  selectedIds: [] as number[],
  anchorIndex: null as number | null,
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
            : { typeFilter, selectedIds: [], anchorIndex: null },
        ),
      setSort: (sort) =>
        set((state) =>
          state.sort === sort ? { sort } : { sort, selectedIds: [], anchorIndex: null },
        ),
      setDensity: (density) => set({ density }),
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
      clearSelection: () => set({ selectedIds: [], anchorIndex: null }),
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
  s: { typeFilter: TypeFilter; sort: SortOption },
  limit: number,
  offset: number,
): MediaQuery {
  return { ...typeFilterToQuery(s.typeFilter), sort: SORT_TO_QUERY[s.sort], limit, offset };
}
