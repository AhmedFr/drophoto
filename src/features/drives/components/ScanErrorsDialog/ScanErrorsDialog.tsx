import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DotLoader } from "@/components/DotLoader";
import { countScanErrors, listScanErrors } from "@/lib/api/scan";
import type { ScanErrorsDialogProps } from "./ScanErrorsDialog.types";

/** Rows per `listScanErrors` page — matches the brief's "Load more" page size. */
const PAGE_SIZE = 100;

/**
 * Browses one drive's recorded `scan_errors`, newest first, paged 100 at a
 * time via "Load more" — the field report this exists for: "a scan fails
 * with a huge amount of errors but no reason, no place to check the
 * errors". Opened from `ScanProgress`'s terminal "N failed" button (once a
 * scan finishes with failures) and from `DriveCard`'s actions dropdown
 * ("Errors…", shown once the drive has any recorded rows).
 *
 * The header count comes from `countScanErrors` (the same cheap query
 * `DriveCard` uses to decide whether to show "Errors…" at all, sharing its
 * cache) rather than the loaded row count, so it stays accurate even
 * before every page has been fetched.
 */
export function ScanErrorsDialog({ drive, onClose }: ScanErrorsDialogProps) {
  const driveId = drive?.id ?? null;

  const countQuery = useQuery({
    queryKey: ["scan-error-count", driveId],
    queryFn: () => countScanErrors(driveId as number),
    enabled: driveId != null,
  });

  const rowsQuery = useInfiniteQuery({
    queryKey: ["scan-errors", driveId],
    queryFn: ({ pageParam }) => listScanErrors(driveId as number, PAGE_SIZE, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
    enabled: driveId != null,
  });

  // Stable reference across renders where `rowsQuery.data` hasn't changed —
  // same reasoning as `useMediaInfinite`'s `items`.
  const rows = useMemo(() => rowsQuery.data?.pages.flat() ?? [], [rowsQuery.data]);
  const total = countQuery.data ?? rows.length;

  return (
    <Dialog open={drive != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Errors
            {drive ? ` — ${drive.name}` : ""}
            {total > 0 ? ` (${total})` : ""}
          </DialogTitle>
        </DialogHeader>

        {rowsQuery.isLoading ? (
          <div className="flex justify-center py-8">
            <DotLoader label="Loading errors…" />
          </div>
        ) : rows.length === 0 ? (
          <p className="font-mono text-[11px] text-dim">No scan errors</p>
        ) : (
          <div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
            {rows.map((row) => (
              <div key={row.id} className="flex flex-col gap-0.5 border-b border-border py-1.5 last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={row.path}>
                    {row.path}
                  </span>
                  <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-muted-foreground uppercase">
                    {row.code}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-faint">{row.message}</span>
              </div>
            ))}
          </div>
        )}

        {rowsQuery.hasNextPage && (
          <DialogFooter className="sm:justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => rowsQuery.fetchNextPage()}
              disabled={rowsQuery.isFetchingNextPage}
            >
              {rowsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
