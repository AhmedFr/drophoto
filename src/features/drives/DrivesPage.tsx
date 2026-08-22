import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { listVolumes } from "@/lib/api/volumes";
import { VolumeList } from "./components/VolumeList";

export function DrivesPage() {
  const volumes = useQuery({ queryKey: ["volumes"], queryFn: listVolumes, refetchInterval: 5_000 });
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Drives" />
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-5 pb-2 font-mono text-[9px] tracking-[2.5px] text-faint">
          MOUNTED VOLUMES
        </div>
        {volumes.isError && (
          <p className="px-5 font-mono text-[11px] text-red-400">{(volumes.error as Error).message}</p>
        )}
        <VolumeList volumes={volumes.data ?? []} />
      </div>
    </div>
  );
}
