import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTagMutations } from "../../hooks/useTagMutations";
import type { DeleteTagDialogProps } from "./DeleteTagDialog.types";

/**
 * Confirms deleting a tag. Per the brief: states exactly how many photos
 * lose the tag and that sidecars get queued for a rewrite, and is explicit
 * that no photo file is ever touched — only the catalog's tag link and,
 * eventually, each affected photo's `.xmp` sidecar.
 */
export function DeleteTagDialog({ tagWithCount, onClose }: DeleteTagDialogProps) {
  const { remove, isDeleting, deleteError, resetDelete } = useTagMutations();

  function handleClose() {
    resetDelete();
    onClose();
  }

  function handleDelete() {
    if (!tagWithCount) return;
    remove(tagWithCount.tag.id, { onSuccess: handleClose });
  }

  const count = tagWithCount?.count ?? 0;

  return (
    <Dialog open={tagWithCount !== null} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete tag{tagWithCount ? ` "${tagWithCount.tag.name}"` : ""}?</DialogTitle>
          <DialogDescription>
            {tagWithCount
              ? `Removes this tag from ${count} ${count === 1 ? "photo" : "photos"} and queues ${
                  count === 1 ? "its sidecar" : "their sidecars"
                } for a rewrite. Never touches any photo file.`
              : null}
          </DialogDescription>
        </DialogHeader>

        {deleteError && <p className="font-mono text-[11px] text-red-400">{deleteError}</p>}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleClose} disabled={isDeleting}>
            CANCEL
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isDeleting}>
            {isDeleting ? "DELETING…" : "DELETE"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
