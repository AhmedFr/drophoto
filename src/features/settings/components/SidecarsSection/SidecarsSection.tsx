import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listDrives } from "@/lib/api/drives";
import { checkSidecarFiles, sidecarHealth, startSidecarSyncAll } from "@/lib/api/sidecars";
import type { SidecarDriveRowProps } from "./SidecarsSection.types";

/** One online drive's tagged/pending counts plus its CHECK FILES / SYNC NOW actions. */
function SidecarDriveRow({ drive }: SidecarDriveRowProps) {
  const queryClient = useQueryClient();

  const healthQuery = useQuery({
    queryKey: ["sidecar-health", drive.id],
    queryFn: () => sidecarHealth(drive.id),
  });

  // Stats every tagged row's `.xmp` on disk (read-only) and queues any
  // that are missing — the actual rewrite happens later, via SYNC NOW
  // (or the auto-sweep after a scan). Toast copy is the outcome, not a
  // success/failure framing: finding nothing to queue gets the success
  // color, finding missing sidecars just states what happened.
  const checkMutation = useMutation({
    mutationFn: () => checkSidecarFiles(drive.id),
    onSuccess: (missing) => {
      queryClient.invalidateQueries({ queryKey: ["sidecar-health", drive.id] });
      if (missing > 0) {
        toast(`${missing} sidecars missing — queued for rewrite`);
      } else {
        toast.success("All sidecar files present");
      }
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Failed to check sidecar files.");
    },
  });

  // The existing background sweep — see `start_sidecar_sync_all`. Its own
  // terminal event (via `onTerminalEvent`) is what actually refreshes
  // this row's counts once the sync finishes, same as every other job.
  const syncMutation = useMutation({
    mutationFn: startSidecarSyncAll,
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Failed to start sidecar sync.");
    },
  });

  const health = healthQuery.data;

  return (
    <li className="flex items-center gap-2 border-b border-border py-2 last:border-b-0">
      <span className="text-[12px]">{drive.name}</span>
      <span className="font-mono text-[10px] text-muted-foreground">
        {healthQuery.isLoading
          ? "Checking…"
          : health
            ? `${health.tagged} tagged · ${health.pending} pending`
            : healthQuery.error
              ? (healthQuery.error as Error).message
              : "—"}
      </span>
      <span className="flex-1" />
      <Button variant="outline" size="xs" onClick={() => checkMutation.mutate()} disabled={checkMutation.isPending}>
        {checkMutation.isPending ? "Checking…" : "Check files"}
      </Button>
      <Button variant="outline" size="xs" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
        {syncMutation.isPending ? "Syncing…" : "Sync now"}
      </Button>
    </li>
  );
}

/**
 * Settings' SIDECARS panel: per registered drive, a row showing whether
 * it's checkable at all. An online drive gets its live tagged/pending
 * counts (`["sidecar-health", driveId]`, see `SidecarDriveRow`) plus CHECK
 * FILES (stats every tagged row's `.xmp` on disk and queues any that are
 * missing — read-only, never writes to the user's photos or sidecars
 * itself) and SYNC NOW (the existing `start_sidecar_sync_all` sweep,
 * which actually rewrites queued sidecars). An offline drive has no mount
 * to stat against, so it's shown with neither count nor action — just a
 * prompt to reconnect it.
 */
export function SidecarsSection() {
  const drivesQuery = useQuery({ queryKey: ["drives"], queryFn: listDrives });
  const drives = drivesQuery.data ?? [];

  return (
    <div className="flex flex-col">
      <div className="flex items-center px-6 pt-5 pb-2">
        <span className="font-mono text-[9px] tracking-[2px] text-faint">SIDECARS</span>
      </div>

      {drivesQuery.isLoading ? (
        <p className="px-6 pb-6 font-mono text-[11px] text-faint">Loading drives…</p>
      ) : drives.length === 0 ? (
        <p className="px-6 pb-6 font-mono text-[11px] text-faint">No drives registered.</p>
      ) : (
        <ul className="flex flex-col px-6 pb-6">
          {drives.map((drive) =>
            drive.online ? (
              <SidecarDriveRow key={drive.id} drive={drive} />
            ) : (
              <li key={drive.id} className="flex items-center gap-2 border-b border-border py-2 last:border-b-0">
                <span className="text-[12px] text-muted-foreground">{drive.name}</span>
                <span className="flex-1" />
                <span className="font-mono text-[10px] text-faint">offline — plug in to check</span>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
