import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTagMutations } from "../../hooks/useTagMutations";
import type { RenameTagDialogProps } from "./RenameTagDialog.types";

/**
 * Renames `tag`. If the new name collides (case-insensitively) with a
 * different existing tag, the server merges the two instead of erroring —
 * this dialog surfaces that as a plain success, same as a normal rename,
 * since from the user's perspective they asked for a name and got it.
 */
export function RenameTagDialog({ tag, onClose }: RenameTagDialogProps) {
  const { rename, isRenaming, renameError, resetRename } = useTagMutations();
  const [name, setName] = useState(tag?.name ?? "");

  // Reset the staged input whenever the dialog opens for a (possibly
  // different) tag — the standard "adjust state during render when a prop
  // changes" pattern, same as `TagPanel`'s per-open reset.
  const [resetForTag, setResetForTag] = useState(tag);
  if (tag !== resetForTag) {
    setResetForTag(tag);
    setName(tag?.name ?? "");
    resetRename();
  }

  function handleClose() {
    resetRename();
    onClose();
  }

  function handleRename() {
    if (!tag) return;
    rename({ id: tag.id, newName: name }, { onSuccess: handleClose });
  }

  const trimmed = name.trim();
  const unchanged = trimmed === tag?.name;

  return (
    <Dialog open={tag !== null} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename tag</DialogTitle>
          <DialogDescription>
            {tag
              ? `Renaming "${tag.name}" to a name that already exists merges the two tags into one.`
              : null}
          </DialogDescription>
        </DialogHeader>

        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && !unchanged && trimmed !== "") handleRename();
          }}
        />

        {renameError && <p className="font-mono text-[11px] text-red-400">{renameError}</p>}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleClose} disabled={isRenaming}>
            CANCEL
          </Button>
          <Button size="sm" onClick={handleRename} disabled={isRenaming || unchanged || trimmed === ""}>
            {isRenaming ? "RENAMING…" : "RENAME"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
