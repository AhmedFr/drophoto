import { PageHeader } from "@/components/PageHeader";
import { StatTiles } from "./components/StatTiles";
import { RecentJobs } from "./components/RecentJobs";
import { DriveCapacity } from "./components/DriveCapacity";
import { useDashboard } from "./hooks/useDashboard";

export function DashboardPage() {
  const { drives, jobs, photoCount, videoCount, unorganizedCount, isError, error } = useDashboard();
  const drivesOnline = drives.filter((d) => d.online).length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Dashboard">
        <span className="font-mono text-[10px] text-faint">
          {drivesOnline}/{drives.length} drives online
        </span>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        {isError && (
          <p className="px-5 pt-5 font-mono text-[11px] text-red-400">{error?.message}</p>
        )}
        <StatTiles
          photos={photoCount}
          videos={videoCount}
          unorganized={unorganizedCount}
          drivesOnline={drivesOnline}
          drivesTotal={drives.length}
        />
        <RecentJobs jobs={jobs} />
        <DriveCapacity drives={drives} />
      </div>
    </div>
  );
}
