import { useQuery } from "@tanstack/react-query";
import { toolHealth } from "@/lib/api/settings";
import type { UseToolHealthDataResult } from "./useToolHealthData.types";

/**
 * The startup tool-health snapshot for the Settings "Maintenance" group's
 * `ToolsSection`. Split out of the former single `useSettingsData` so
 * mounting Maintenance doesn't also fire `get_settings`/`storage_usage`,
 * which it never renders anything for.
 */
export function useToolHealthData(): UseToolHealthDataResult {
  // A startup snapshot on the Rust side — never changes while the app
  // runs, so staleTime: Infinity (no background refetches).
  const toolsQuery = useQuery({ queryKey: ["tool-health"], queryFn: toolHealth, staleTime: Infinity });

  return {
    tools: toolsQuery.data ?? null,
    toolsLoading: toolsQuery.isLoading,
    toolsError: toolsQuery.error ? (toolsQuery.error as Error).message : null,
  };
}
