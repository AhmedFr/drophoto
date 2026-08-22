import { useQuery } from "@tanstack/react-query";
import { planOrganize } from "@/lib/api/organize";

/**
 * Fetches the organize plan for the given drive ids. Disabled with no
 * drives selected, since `plan_organize` expects at least one id — the
 * wizard's step 0 never lets you reach step 1 with an empty selection,
 * but this guards the hook against being called in isolation too.
 */
export function usePlan(driveIds: number[]) {
  return useQuery({
    queryKey: ["plan", driveIds],
    queryFn: () => planOrganize(driveIds),
    enabled: driveIds.length > 0,
  });
}
