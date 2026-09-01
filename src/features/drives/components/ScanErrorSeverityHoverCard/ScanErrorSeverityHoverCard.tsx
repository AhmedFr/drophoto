import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { scanErrorCodeCounts } from "@/lib/api/scan";
import { severityForCode, styleForLevel } from "../ScanErrorSeverity";
import type { ScanErrorSeverityLevel } from "../ScanErrorSeverity";
import type { ScanErrorSeverityHoverCardProps } from "./ScanErrorSeverityHoverCard.types";

/** Fixed display order — most urgent first, same as `ScanErrorsDialog`'s header summary. */
const SEVERITY_ORDER: readonly ScanErrorSeverityLevel[] = ["critical", "error", "warning", "info"];

/**
 * Wraps `ScanProgress`'s terminal "N failed" button: hovering it fetches
 * this drive's `scan_error_code_counts` (shared query key/cache with
 * `ScanErrorsDialog`'s header) and shows the severity repartition — a
 * colored dot, the severity label, and its count, one row per severity
 * actually present. Lets the user gauge how bad a scan's failures are
 * (a pile of `unsupported` files reads very differently from `db`
 * failures) without opening the full `ScanErrorsDialog`.
 */
export function ScanErrorSeverityHoverCard({ driveId, children }: ScanErrorSeverityHoverCardProps) {
  const codeCounts = useQuery({
    queryKey: ["scan-error-code-counts", driveId],
    queryFn: () => scanErrorCodeCounts(driveId),
  });

  const bySeverity = useMemo(() => {
    const totals: Record<ScanErrorSeverityLevel, number> = {
      critical: 0,
      error: 0,
      warning: 0,
      info: 0,
    };
    for (const { code, count } of codeCounts.data ?? []) {
      totals[severityForCode(code).level] += count;
    }
    return totals;
  }, [codeCounts.data]);

  return (
    <HoverCard openDelay={0} closeDelay={0}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-auto min-w-36 p-2">
        <div className="flex flex-col gap-1.5">
          {SEVERITY_ORDER.filter((level) => bySeverity[level] > 0).map((level) => {
            const style = styleForLevel(level);
            return (
              <div key={level} className="flex items-center gap-2 font-mono text-[10px]">
                <span className={`size-1.5 shrink-0 rounded-full ${style.dotClass}`} />
                <span className="text-muted-foreground">{style.label}</span>
                <span className="ml-auto tabular-nums">{bySeverity[level]}</span>
              </div>
            );
          })}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
