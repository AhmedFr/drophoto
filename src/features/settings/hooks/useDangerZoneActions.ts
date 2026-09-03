import { useMutation } from "@tanstack/react-query";
import { resetAppData, uninstallApp } from "@/lib/api/settings";
import type { UseDangerZoneActionsResult } from "./useDangerZoneActions.types";

/**
 * The reset-app-data / uninstall mutations for the Settings "Danger zone"
 * group. Split out of the former single `useSettingsData` so mounting
 * Danger zone doesn't also fire `get_settings`/`storage_usage`/
 * `tool_health`, none of which it renders anything for.
 */
export function useDangerZoneActions(): UseDangerZoneActionsResult {
  const resetMutation = useMutation({ mutationFn: resetAppData });
  const uninstallMutation = useMutation({ mutationFn: uninstallApp });

  return {
    confirmResetAppData: () => resetMutation.mutate(),
    resetting: resetMutation.isPending,
    // Rendered inside `ResetAppDataDialog` (which stays open on failure),
    // matching how `ForgetDriveDialog`/`RelinkDriveDialog` surface their
    // own mutation errors.
    resetError: resetMutation.error ? (resetMutation.error as Error).message : null,

    confirmUninstall: () => uninstallMutation.mutate(),
    uninstalling: uninstallMutation.isPending,
    // Rendered inside `UninstallDialog` (which stays open on failure) —
    // same pattern as `resetError` above.
    uninstallError: uninstallMutation.error ? (uninstallMutation.error as Error).message : null,
  };
}
