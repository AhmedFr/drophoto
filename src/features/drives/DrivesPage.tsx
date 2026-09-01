import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { listVolumes } from "@/lib/api/volumes";
import type { Volume } from "@/lib/api/volumes";
import {
  listDrives,
  registerDrive,
  forgetDrive,
  countDriveMedia,
  relinkDrive,
} from "@/lib/api/drives";
import type { Drive } from "@/lib/api/drives";
import { startScan, cancelJob } from "@/lib/api/scan";
import type { JobEvent } from "@/lib/api/scan";
import { useTauriEvent } from "@/lib/hooks/useTauriEvent";
import { useJobsStore } from "@/lib/jobs/jobsStore";
import { isVolumeClaimedByAnotherDrive } from "./driveIdentity";
import { VolumeList } from "./components/VolumeList";
import { DriveCard } from "./components/DriveCard";
import { RegisterDriveDialog } from "./components/RegisterDriveDialog";
import { SourcesDialog } from "./components/SourcesDialog";
import { ForgetDriveDialog } from "./components/ForgetDriveDialog";
import { RelinkDriveDialog } from "./components/RelinkDriveDialog";
import { ScanErrorsDialog } from "./components/ScanErrorsDialog";
import { useJobEvents } from "./hooks/useJobEvents";
import { useSources } from "./hooks/useSources";

/**
 * The id of the `scan-*` job mapped to `driveId` via `jobsStore`'s
 * `driveIds`, if any — reading from the global store (rather than
 * page-local state) is what lets a card keep showing its scan's progress
 * (or, once it's done, its terminal readout — `ScanProgress`'s
 * `"N ok · N failed · N skipped"` / `"Up to date · N skipped"` line) after
 * `DrivesPage` unmounts and remounts (e.g. navigating away and back), and
 * after the scan itself finishes or is cancelled. This deliberately does
 * *not* filter to `started`/`progress`: a `finished`/`cancelled` event must
 * still be returned so the card keeps rendering it. `matches` should never
 * hold more than one entry in practice — `DriveCard` disables Scan/Full
 * while a scan is already running for that drive — but takes the last (in
 * `Object.entries` insertion order, i.e. the most recently applied event)
 * as a defensive fallback rather than assuming that invariant holds; this
 * is also what lets a *new* scan's `started` event, once applied, take over
 * from a prior scan's lingering terminal event for the same drive.
 */
function activeScanJobId(
  driveId: number,
  events: Record<string, JobEvent>,
  driveIds: Record<string, number>,
): string | undefined {
  const matches = Object.entries(events)
    .filter(([jobId]) => jobId.startsWith("scan-") && driveIds[jobId] === driveId)
    .map(([jobId]) => jobId);
  return matches[matches.length - 1];
}

export function DrivesPage() {
  const queryClient = useQueryClient();
  const volumes = useQuery({ queryKey: ["volumes"], queryFn: listVolumes, refetchInterval: 5_000 });
  const drives = useQuery({ queryKey: ["drives"], queryFn: listDrives });
  const [pending, setPending] = useState<Volume | null>(null);
  const [sourcesDrive, setSourcesDrive] = useState<Drive | null>(null);
  const [driveToForget, setDriveToForget] = useState<Drive | null>(null);
  const [driveToRelink, setDriveToRelink] = useState<Drive | null>(null);
  const [driveForErrors, setDriveForErrors] = useState<Drive | null>(null);
  const jobEvents = useJobEvents();
  const driveIds = useJobsStore((s) => s.driveIds);
  const { sourcesByDrive, isLoading: sourcesLoading } = useSources(
    (drives.data ?? []).map((d) => d.id),
  );

  useTauriEvent("drives:changed", () => {
    queryClient.invalidateQueries({ queryKey: ["drives"] });
  });

  const mutation = useMutation({
    mutationFn: registerDrive,
    onSuccess: (newDrive) => {
      queryClient.invalidateQueries({ queryKey: ["drives"] });
      setPending(null);
      setSourcesDrive(newDrive);
    },
  });

  const scanMutation = useMutation({
    mutationFn: async ({ driveId, full = false }: { driveId: number; full?: boolean }) => ({
      driveId,
      jobId: await startScan(driveId, full),
    }),
    onSuccess: ({ driveId, jobId }) => {
      // Recorded in the global store (not page-local state) so the running
      // scan survives navigating away from and back to this page — see
      // `scanEvent`/`onCancelScan` below, which derive from it.
      useJobsStore.getState().setJobDrive(jobId, driveId);
      // Cheap to do here — the drive's name is already on hand — so the
      // global `ActiveJobs` strip and terminal-event toast can show it
      // instead of falling back to just "Scan".
      const driveName = drives.data?.find((d) => d.id === driveId)?.name;
      if (driveName) useJobsStore.getState().setLabel(jobId, driveName);
    },
  });

  const handleDialogClose = () => {
    setPending(null);
    mutation.reset();
  };

  const driveMediaCount = useQuery({
    queryKey: ["driveMediaCount", driveToForget?.id],
    queryFn: () => countDriveMedia(driveToForget?.id as number),
    enabled: driveToForget != null,
  });

  const forgetMutation = useMutation({
    mutationFn: forgetDrive,
    onSuccess: (_data, forgottenDriveId) => {
      queryClient.invalidateQueries({ queryKey: ["drives"] });
      // The forgotten drive's cached media count must not linger — drive
      // ids are reused (no AUTOINCREMENT), so a stale cache entry here
      // could otherwise be served to a brand-new drive that happens to
      // reuse the same id before it ever runs its own count query.
      queryClient.invalidateQueries({ queryKey: ["driveMediaCount", forgottenDriveId] });
      setDriveToForget(null);
    },
  });

  const handleForgetDialogClose = () => {
    setDriveToForget(null);
    forgetMutation.reset();
  };

  const relinkMutation = useMutation({
    mutationFn: ({ driveId, mountPath }: { driveId: number; mountPath: string }) =>
      relinkDrive(driveId, mountPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drives"] });
      setDriveToRelink(null);
    },
  });

  const handleRelinkDialogClose = () => {
    setDriveToRelink(null);
    relinkMutation.reset();
  };

  const registeredMountPaths = new Set(
    (drives.data ?? []).map((d) => d.mount_path).filter((p): p is string => p != null),
  );
  const unregisteredVolumes = (volumes.data ?? []).filter(
    (v) => !registeredMountPaths.has(v.mount_path),
  );
  const relinkCandidates = (volumes.data ?? []).filter(
    (v) => !isVolumeClaimedByAnotherDrive(v, drives.data ?? [], driveToRelink?.id),
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Drives" />
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-5 pb-2 font-mono text-[9px] tracking-[2.5px] text-faint">
          REGISTERED DRIVES
        </div>
        {drives.isError && (
          <p className="px-5 font-mono text-[11px] text-red-400">
            {(drives.error as Error).message}
          </p>
        )}
        {drives.data?.length ? (
          <ul className="flex flex-col">
            {drives.data.map((d) => {
              const jobId = activeScanJobId(d.id, jobEvents, driveIds);
              return (
                <DriveCard
                  key={d.id}
                  drive={d}
                  sources={sourcesByDrive[d.id]}
                  sourcesLoading={sourcesLoading}
                  onScan={() => scanMutation.mutate({ driveId: d.id })}
                  onFullScan={() => scanMutation.mutate({ driveId: d.id, full: true })}
                  scanEvent={jobId ? jobEvents[jobId] : undefined}
                  onCancelScan={jobId ? () => cancelJob(jobId) : undefined}
                  onOpenSources={() => setSourcesDrive(d)}
                  onForget={() => setDriveToForget(d)}
                  onRelink={() => setDriveToRelink(d)}
                  onOpenErrors={() => setDriveForErrors(d)}
                />
              );
            })}
          </ul>
        ) : (
          <p className="px-5 py-3 font-mono text-[11px] text-faint">No drives registered</p>
        )}

        <div className="px-5 pt-5 pb-2 font-mono text-[9px] tracking-[2.5px] text-faint">
          MOUNTED VOLUMES
        </div>
        {volumes.isError && (
          <p className="px-5 font-mono text-[11px] text-red-400">
            {(volumes.error as Error).message}
          </p>
        )}
        <VolumeList volumes={unregisteredVolumes} onRegister={setPending} />
      </div>
      <RegisterDriveDialog
        volume={pending}
        error={mutation.isError ? (mutation.error as Error).message : null}
        onClose={handleDialogClose}
        onSubmit={(input) => mutation.mutate(input)}
      />
      <SourcesDialog drive={sourcesDrive} onClose={() => setSourcesDrive(null)} />
      <ForgetDriveDialog
        drive={driveToForget}
        mediaCount={driveMediaCount.data ?? null}
        mediaCountError={driveMediaCount.isError ? (driveMediaCount.error as Error).message : null}
        forgetting={forgetMutation.isPending}
        error={forgetMutation.isError ? (forgetMutation.error as Error).message : null}
        onOpenChange={(open) => !open && handleForgetDialogClose()}
        onConfirm={() => driveToForget && forgetMutation.mutate(driveToForget.id)}
      />
      <RelinkDriveDialog
        drive={driveToRelink}
        candidates={relinkCandidates}
        relinking={relinkMutation.isPending}
        error={relinkMutation.isError ? (relinkMutation.error as Error).message : null}
        onOpenChange={(open) => !open && handleRelinkDialogClose()}
        onConfirm={(mountPath) =>
          driveToRelink && relinkMutation.mutate({ driveId: driveToRelink.id, mountPath })
        }
      />
      <ScanErrorsDialog drive={driveForErrors} onClose={() => setDriveForErrors(null)} />
    </div>
  );
}
