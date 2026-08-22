import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MediaQuery, MediaSort } from "@/lib/api/media";
import { typeFilterToQuery, type TypeFilter } from "@/lib/media/typeFilter";

export type SortOption = "NEWEST" | "OLDEST" | "ADDED";
export type Density = "Comfortable" | "Compact" | "Dense";

export const SORT_TO_QUERY: Record<SortOption, MediaSort> = {
  NEWEST: "taken_desc",
  OLDEST: "taken_asc",
  ADDED: "added_desc",
};

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

export const useGalleryStore = create<GalleryState>()(
  persist(
    (set) => ({
      typeFilter: "ALL",
      sort: "NEWEST",
      density: "Comfortable",
      setTypeFilter: (typeFilter) => set({ typeFilter }),
      setSort: (sort) => set({ sort }),
      setDensity: (density) => set({ density }),
    }),
    {
      name: "drophoto.gallery",
      partialize: (s) => ({ typeFilter: s.typeFilter, sort: s.sort, density: s.density }),
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
