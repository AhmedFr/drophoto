import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { UpdatesSectionProps } from "./UpdatesSection.types";

export function UpdatesSection({
  status,
  currentVersion,
  version,
  notes,
  percent,
  check,
  install,
  relaunch,
}: UpdatesSectionProps) {
  const canManualCheck = status === "upToDate" || status === "error";

  return (
    <div className="flex flex-col">
      <div className="flex items-center px-6 pt-5 pb-2">
        <span className="font-mono text-[9px] tracking-[2px] text-faint">UPDATES</span>
        <span className="flex-1" />
        {canManualCheck && (
          <Button variant="outline" size="xs" onClick={check}>
            Check for updates
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3 px-6 pb-6">
        <p className="font-mono text-[10px] text-faint">
          {currentVersion ? `Current: v${currentVersion}` : "Current: —"}
        </p>

        {status === "checking" && <p className="font-mono text-[11px] text-faint">Checking for updates…</p>}

        {status === "upToDate" && (
          <p className="font-mono text-[11px] text-faint">You&apos;re on the latest version.</p>
        )}

        {/* Deliberately quiet and generic — never the raw error message
            (e.g. the plugin's rejection of the placeholder `pubkey`), which
            would read as a scary crash report for something that's really
            just "can't tell right now"; see `src/lib/api/updater.ts`. */}
        {status === "error" && <p className="font-mono text-[11px] text-faint">Couldn&apos;t check for updates.</p>}

        {status === "available" && version && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[12px]">v{version} available</span>
              <span className="flex-1" />
              <Button size="sm" onClick={install}>
                Install
              </Button>
            </div>
            {notes && <p className="font-mono text-[10.5px] whitespace-pre-line text-muted-foreground">{notes}</p>}
          </div>
        )}

        {status === "downloading" && (
          <div className="flex flex-col gap-2">
            <p className="font-mono text-[11px] text-faint">Downloading update… {percent}%</p>
            <Progress value={percent} />
          </div>
        )}

        {status === "readyToRelaunch" && (
          <div className="flex items-center gap-2">
            <span className="text-[12px]">Update installed.</span>
            <span className="flex-1" />
            <Button size="sm" onClick={relaunch}>
              Restart to finish
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
