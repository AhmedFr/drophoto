import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { RemoveMissingDialogProps } from "./RemoveMissingDialog.types";

/**
 * Confirms the "Remove missing…" danger-zone action — deletes every
 * catalog row on this drive currently marked missing. Unlike
 * `ForgetDriveDialog`/`ResetAppDataDialog`, this needs no typed
 * confirmation phrase: the files it's about to act on are already gone
 * from disk (the whole reason they're offered here), so there's no live
 * data on the drive this action could put at risk — only stale catalog
 * rows.
 */
export function RemoveMissingDialog({
  drive,
  missingCount,
  missingCountError,
  removing,
  error,
  onOpenChange,
  onConfirm,
}: RemoveMissingDialogProps) {
  return (
    <Dialog open={drive != null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{drive ? `Remove missing files on "${drive.name}"` : "Remove missing files"}</DialogTitle>
        </DialogHeader>

        <p className="text-[13px] text-muted-foreground">
          {missingCountError
            ? "Couldn't determine how many files are currently missing — you can still remove them."
            : missingCount == null
              ? "Checking how many files are currently missing…"
              : `Removes ${missingCount} catalog ${missingCount === 1 ? "entry" : "entries"} for files that couldn't be found on the last scan.`}
        </p>
        <p className="text-[13px] text-muted-foreground">
          Catalog entries only — nothing is deleted from disk. These files are already gone (or
          moved outside drophoto); their thumbnails stay in the local thumbnail store.
        </p>
        {missingCountError && <p className="font-mono text-[11px] text-red-400">{missingCountError}</p>}
        {error && <p className="font-mono text-[11px] text-red-400">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={removing}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={removing} onClick={onConfirm}>
            {removing ? "Removing…" : "Remove missing"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
