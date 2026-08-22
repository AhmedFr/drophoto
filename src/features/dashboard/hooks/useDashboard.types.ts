import type { Drive } from "@/lib/api/drives";
import type { OrganizeJobRow } from "@/lib/api/organize";

export type UseDashboardResult = {
  drives: Drive[];
  jobs: OrganizeJobRow[];
  photoCount: number;
  videoCount: number;
  unorganizedCount: number;
  isLoading: boolean;
  isError: boolean;
  /** The first query error encountered, if any (for surfacing a message). */
  error: Error | null;
};
