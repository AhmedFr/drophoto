import { MoreVertical } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatBytes } from "@/lib/format/bytes";
import { countScanErrors } from "@/lib/api/scan";
import { ScanProgress } from "../ScanProgress";
import type { DriveCardProps } from "./DriveCard.types";

export function DriveCard({
  drive,
  sources = [],
  sourcesLoading = false,
  onScan,
  onFullScan,
  onCancelScan,
  onOpenSources,
  onForget,
  onRelink,
  onOpenErrors,
  scanEvent,
}: DriveCardProps) {
  // Cheap, cached (same query key `ScanErrorsDialog` reads its own count
  // from, so the two never disagree) — only decides whether "Errors…"
  // appears in the dropdown at all, so a drive with a clean scan history
  // never shows a dead-end menu item.
  const scanErrorCount = useQuery({
    queryKey: ["scan-error-count", drive.id],
    queryFn: () => countScanErrors(drive.id),
  });
  const hasScanErrors = (scanErrorCount.data ?? 0) > 0;

  const scanInProgress =
    scanEvent != null && scanEvent.kind !== "finished" && scanEvent.kind !== "cancelled";
  const enabledSources = sources.filter((s) => s.enabled).length;
  // `sources` defaults to `[]` while the caller's query is still in
  // flight, which is indistinguishable from "none configured" — so a
  // card used to flash a red "No sources" on every mount. Treat the
  // loading window as its own state instead of guessing.
  const noEnabledSources = !sourcesLoading && enabledSources === 0;
  // RELINK only ever makes sense for a drive that's currently unmatched —
  // an online drive is already correctly attached to a volume.
  const showRelink = onRelink != null && !drive.online;

  return (
    <li className="flex flex-col border-b border-border">
      <div className="flex items-center gap-4 px-5 py-3">
        <span className="text-[14px] font-medium">{drive.name}</span>
        <Badge variant="outline">{drive.online ? "ONLINE" : "OFFLINE"}</Badge>
        <span className="flex-1" />
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatBytes(drive.free)} free / {formatBytes(drive.capacity)}
        </span>
        <span
          className={`font-mono text-[10px] ${noEnabledSources ? "text-red-400" : "text-faint"}`}
        >
          {sourcesLoading
            ? "…"
            : noEnabledSources
              ? "No sources"
              : `${enabledSources} source${enabledSources === 1 ? "" : "s"}`}
        </span>
        {onOpenSources && (
          <Button variant="outline" size="xs" onClick={onOpenSources}>
            Sources…
          </Button>
        )}
        {onScan && (
          <Button
            variant="outline"
            size="xs"
            disabled={!drive.online || scanInProgress || sourcesLoading || noEnabledSources}
            title={noEnabledSources ? "Choose sources first" : undefined}
            onClick={onScan}
          >
            Scan
          </Button>
        )}
        {onFullScan && sources.length > 0 && (
          <Button
            variant="outline"
            size="xs"
            disabled={!drive.online || scanInProgress || sourcesLoading || noEnabledSources}
            title={
              noEnabledSources ? "Choose sources first" : "Re-hash and re-thumbnail every file"
            }
            onClick={onFullScan}
          >
            Full
          </Button>
        )}
        {(onForget || showRelink || (hasScanErrors && onOpenErrors)) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="xs" aria-label="Drive actions">
                <MoreVertical className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {hasScanErrors && onOpenErrors && (
                <DropdownMenuItem onClick={onOpenErrors}>Errors…</DropdownMenuItem>
              )}
              {showRelink && <DropdownMenuItem onClick={onRelink}>Relink…</DropdownMenuItem>}
              {onForget && (
                <DropdownMenuItem variant="destructive" onClick={onForget}>
                  Forget…
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {scanEvent && (
        <ScanProgress
          event={scanEvent}
          onCancel={onCancelScan ?? (() => {})}
          onOpenErrors={onOpenErrors}
          driveId={drive.id}
        />
      )}
    </li>
  );
}
