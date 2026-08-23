import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DotLoader } from "@/components/DotLoader";
import { useSourcesDialog } from "../../hooks/useSourcesDialog";
import { DetectedFolderRow } from "../DetectedFolderRow";
import type { SourcesDialogProps } from "./SourcesDialog.types";

export function SourcesDialog({ drive, onClose }: SourcesDialogProps) {
  const { rows, isDetecting, detectError, addError, saveError, isSaving, toggle, addFolder, save } =
    useSourcesDialog(drive, onClose);

  return (
    <Dialog open={drive != null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sources{drive ? ` — ${drive.name}` : ""}</DialogTitle>
        </DialogHeader>

        {isDetecting ? (
          <div className="flex justify-center py-8">
            <DotLoader label="Looking for photo folders…" />
          </div>
        ) : (
          <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
            {rows.length === 0 && (
              <p className="font-mono text-[11px] text-dim">No photo folders found — add one manually.</p>
            )}
            {rows.map((row) => (
              <DetectedFolderRow key={row.rel_path} row={row} onToggle={() => toggle(row.rel_path)} />
            ))}
          </div>
        )}

        {detectError && <p className="font-mono text-[11px] text-red-400">{detectError}</p>}
        {addError && <p className="font-mono text-[11px] text-red-400">{addError}</p>}
        {saveError && <p className="font-mono text-[11px] text-red-400">{saveError}</p>}

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" size="sm" onClick={addFolder} disabled={isDetecting}>
            Add folder…
          </Button>
          <Button size="sm" onClick={save} disabled={isDetecting || isSaving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
