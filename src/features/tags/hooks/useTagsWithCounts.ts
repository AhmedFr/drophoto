import { useQuery } from "@tanstack/react-query";
import { listTagsWithCounts } from "@/lib/api/tags";

/** Every tag with its linked-media count, for the Tags page's list. */
export function useTagsWithCounts() {
  return useQuery({ queryKey: ["tags-with-counts"], queryFn: listTagsWithCounts });
}
