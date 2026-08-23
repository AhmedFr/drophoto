import type { Source } from "@/lib/api/sources";

export type UseSourcesResult = {
  /** Each requested drive's sources, keyed by drive id. Always present
   * for every requested id — `[]` while loading or on failure. */
  sourcesByDrive: Record<number, Source[]>;
  /** Whether any drive's sources are still loading, so callers can tell
   * "not fetched yet" apart from the `[]` that means "none configured". */
  isLoading: boolean;
};
