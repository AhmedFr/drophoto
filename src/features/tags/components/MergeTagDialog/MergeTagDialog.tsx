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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useTagMutations } from "../../hooks/useTagMutations";
import type { MergeTagDialogProps } from "./MergeTagDialog.types";

/**
 * Picks a target tag to merge `tag` into — every photo carrying `tag`
 * ends up carrying the target instead, and `tag` itself is deleted (see
 * `dp_catalog::tags::merge_tags`). `tag` is excluded from its own target
 * list (merging a tag into itself is a no-op the server already handles,
 * but there's no reason to offer it).
 */
export function MergeTagDialog({ tag, allTags, onClose }: MergeTagDialogProps) {
  const { merge, isMerging, mergeError, resetMerge } = useTagMutations();
  const [targetId, setTargetId] = useState<number | null>(null);

  // Reset the staged pick whenever the dialog opens for a (possibly
  // different) tag — same "adjust state during render" pattern as
  // `RenameTagDialog`/`TagPanel`.
  const [resetForTag, setResetForTag] = useState(tag);
  if (tag !== resetForTag) {
    setResetForTag(tag);
    setTargetId(null);
    resetMerge();
  }

  function handleClose() {
    resetMerge();
    onClose();
  }

  function handleMerge() {
    if (!tag || targetId === null) return;
    merge({ fromIds: [tag.id], intoId: targetId }, { onSuccess: handleClose });
  }

  const targets = tag ? allTags.filter((t) => t.id !== tag.id) : [];

  return (
    <Dialog open={tag !== null} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge tag</DialogTitle>
          <DialogDescription>
            {tag
              ? `Every photo tagged "${tag.name}" will be retagged with the tag you pick below, and "${tag.name}" will be deleted.`
              : null}
          </DialogDescription>
        </DialogHeader>

        {targets.length === 0 ? (
          <p className="font-mono text-[11px] text-dim">No other tags to merge into.</p>
        ) : (
          <RadioGroup
            value={targetId !== null ? String(targetId) : undefined}
            onValueChange={(value) => setTargetId(Number(value))}
            className="flex max-h-64 flex-col gap-1 overflow-y-auto"
            aria-label="Merge into"
          >
            {targets.map((t) => (
              <label
                key={t.id}
                htmlFor={`merge-target-${t.id}`}
                className="flex cursor-pointer items-center gap-2 py-1 font-mono text-[11px] text-foreground"
              >
                <RadioGroupItem id={`merge-target-${t.id}`} value={String(t.id)} disabled={isMerging} />
                <span>{t.name}</span>
              </label>
            ))}
          </RadioGroup>
        )}

        {mergeError && <p className="font-mono text-[11px] text-red-400">{mergeError}</p>}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleClose} disabled={isMerging}>
            CANCEL
          </Button>
          <Button size="sm" onClick={handleMerge} disabled={isMerging || targetId === null}>
            {isMerging ? "MERGING…" : "MERGE"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
