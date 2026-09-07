import { useQuery } from "@tanstack/react-query";
import { listTagsWithCounts } from "@/lib/api/tags";

/** Every tag as an album card (count + cover art), for the Tags page's grid. */
export function useTagsWithCounts() {
  return useQuery({ queryKey: ["tags-with-counts"], queryFn: listTagsWithCounts });
}
