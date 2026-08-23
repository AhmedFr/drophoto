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
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revert this run?</DialogTitle>
          <DialogDescription>
            Move {moved} {moved === 1 ? "file" : "files"} back to their original locations?
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
