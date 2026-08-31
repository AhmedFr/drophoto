import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RESET_CONFIRM_PHRASE } from "./ResetAppDataDialog.constants";
import type { ResetAppDataDialogProps } from "./ResetAppDataDialog.types";

export function ResetAppDataDialog({ open, onOpenChange, onConfirm, resetting }: ResetAppDataDialogProps) {
  const [typed, setTyped] = useState("");
  const confirmed = typed === RESET_CONFIRM_PHRASE;

  const handleOpenChange = (next: boolean) => {
    if (!next) setTyped("");
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset app data</DialogTitle>
        </DialogHeader>

        <p className="text-[13px] text-muted-foreground">
          Deletes the catalog and every cached thumbnail. Your photos, folders and .xmp sidecar files on your
          drives are NEVER touched.
        </p>
        <p className="text-[13px] text-muted-foreground">
          To fully uninstall, quit and drag drophoto to the Trash afterwards.
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] tracking-[1.5px] text-faint">
            {`TYPE ${RESET_CONFIRM_PHRASE} TO CONFIRM`}
          </span>
          <Input
            aria-label={`Type ${RESET_CONFIRM_PHRASE} to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={resetting}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!confirmed || resetting} onClick={onConfirm}>
            {resetting ? "Resetting…" : "Reset app data"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
