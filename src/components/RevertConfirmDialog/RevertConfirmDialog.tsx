import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { RevertConfirmDialogProps } from "./RevertConfirmDialog.types";

/** Confirms an organize run's revert before any file is moved back. */
export function RevertConfirmDialog({ open, moved, onCancel, onConfirm }: RevertConfirmDialogProps) {
  const singular = moved === 1;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revert this run?</DialogTitle>
          <DialogDescription>
            {`Move ${moved} ${singular ? "file" : "files"} back to ${singular ? "its" : "their"} original ${
              singular ? "location" : "locations"
            }?`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Revert</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
