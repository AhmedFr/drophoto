import type { MediaQuery } from "@/lib/api/media";

export type TypeFilter = "ALL" | "JPG" | "RAW" | "HEIF" | "PNG" | "VIDEO";

export const TYPE_FILTERS: TypeFilter[] = ["ALL", "JPG", "RAW", "HEIF", "PNG", "VIDEO"];

const TYPE_FILTER_QUERY: Record<TypeFilter, Pick<MediaQuery, "kinds" | "exts">> = {
  ALL: { kinds: [], exts: [] },
  JPG: { kinds: [], exts: ["jpg", "jpeg"] },
  RAW: { kinds: [], exts: ["raf", "cr2", "cr3", "arw", "nef", "dng", "orf", "rw2"] },
  HEIF: { kinds: [], exts: ["heic", "heif"] },
  PNG: { kinds: [], exts: ["png"] },
  VIDEO: { kinds: ["video"], exts: [] },
};

export function typeFilterToQuery(filter: TypeFilter): Pick<MediaQuery, "kinds" | "exts"> {
  return TYPE_FILTER_QUERY[filter];
}
