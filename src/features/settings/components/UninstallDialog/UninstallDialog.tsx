import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UNINSTALL_CONFIRM_PHRASE } from "./UninstallDialog.constants";
import type { UninstallDialogProps } from "./UninstallDialog.types";

export function UninstallDialog({ open, onOpenChange, onConfirm, uninstalling, error }: UninstallDialogProps) {
  const [typed, setTyped] = useState("");
  const confirmed = typed === UNINSTALL_CONFIRM_PHRASE;

  const handleOpenChange = (next: boolean) => {
    if (!next) setTyped("");
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Uninstall drophoto</DialogTitle>
        </DialogHeader>

        <p className="text-[13px] text-muted-foreground">
          Moves drophoto to the Trash and deletes the catalog and every cached thumbnail. Your photos and .xmp
          sidecar files are NEVER touched — your drives keep every file exactly where it is.
        </p>
        {error && <p className="font-mono text-[11px] text-red-400">{error}</p>}

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] tracking-[1.5px] text-faint">
            {`TYPE ${UNINSTALL_CONFIRM_PHRASE} TO CONFIRM`}
          </span>
          <Input
            aria-label={`Type ${UNINSTALL_CONFIRM_PHRASE} to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={uninstalling}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!confirmed || uninstalling} onClick={onConfirm}>
            {uninstalling ? "Uninstalling…" : "Uninstall drophoto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
