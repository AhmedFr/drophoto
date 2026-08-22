import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { listVolumes } from "@/lib/api/volumes";
import type { Volume } from "@/lib/api/volumes";
import { listDrives, registerDrive } from "@/lib/api/drives";
import { startScan, cancelJob } from "@/lib/api/scan";
import { useTauriEvent } from "@/lib/hooks/useTauriEvent";
import { VolumeList } from "./components/VolumeList";
import { DriveCard } from "./components/DriveCard";
import { RegisterDriveDialog } from "./components/RegisterDriveDialog";
import { useJobEvents } from "./hooks/useJobEvents";

export function DrivesPage() {
  const queryClient = useQueryClient();
  const volumes = useQuery({ queryKey: ["volumes"], queryFn: listVolumes, refetchInterval: 5_000 });
  const drives = useQuery({ queryKey: ["drives"], queryFn: listDrives });
  const [pending, setPending] = useState<Volume | null>(null);
  const [scanJobs, setScanJobs] = useState<Record<number, string>>({});
  const jobEvents = useJobEvents();

  useTauriEvent("drives:changed", () => {
    queryClient.invalidateQueries({ queryKey: ["drives"] });
  });

  const mutation = useMutation({
    mutationFn: registerDrive,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drives"] });
      setPending(null);
    },
  });

  const scanMutation = useMutation({
    mutationFn: async (driveId: number) => ({ driveId, jobId: await startScan(driveId) }),
    onSuccess: ({ driveId, jobId }) => {
      setScanJobs((prev) => ({ ...prev, [driveId]: jobId }));
    },
  });

  const handleDialogClose = () => {
    setPending(null);
    mutation.reset();
  };

  const registeredMountPaths = new Set(
    (drives.data ?? []).map((d) => d.mount_path).filter((p): p is string => p != null),
  );
  const unregisteredVolumes = (volumes.data ?? []).filter(
    (v) => !registeredMountPaths.has(v.mount_path),
  );

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Drives" />
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-5 pb-2 font-mono text-[9px] tracking-[2.5px] text-faint">
          REGISTERED DRIVES
        </div>
        {drives.isError && (
          <p className="px-5 font-mono text-[11px] text-red-400">{(drives.error as Error).message}</p>
        )}
        {drives.data?.length ? (
          <ul className="flex flex-col">
            {drives.data.map((d) => {
              const jobId = scanJobs[d.id];
              return (
                <DriveCard
                  key={d.id}
                  drive={d}
                  onScan={() => scanMutation.mutate(d.id)}
                  scanEvent={jobId ? jobEvents[jobId] : undefined}
                  onCancelScan={jobId ? () => cancelJob(jobId) : undefined}
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
          <p className="px-5 font-mono text-[11px] text-red-400">{(volumes.error as Error).message}</p>
        )}
        <VolumeList volumes={unregisteredVolumes} onRegister={setPending} />
      </div>
      <RegisterDriveDialog
        volume={pending}
        error={mutation.isError ? (mutation.error as Error).message : null}
        onClose={handleDialogClose}
        onSubmit={(input) => mutation.mutate(input)}
      />
    </div>
  );
}
