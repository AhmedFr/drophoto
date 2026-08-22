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
};

const DEFAULTS = {
  typeFilter: "ALL" as TypeFilter,
  sort: DEFAULT_SORT,
  density: "Comfortable" as Density,
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
      setTypeFilter: (typeFilter) => set({ typeFilter }),
      setSort: (sort) => set({ sort }),
      setDensity: (density) => set({ density }),
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
