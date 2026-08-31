import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FORGET_CONFIRM_PHRASE } from "./ForgetDriveDialog.constants";
import type { ForgetDriveDialogProps } from "./ForgetDriveDialog.types";

export function ForgetDriveDialog({
  drive,
  mediaCount,
  forgetting,
  error,
  onOpenChange,
  onConfirm,
}: ForgetDriveDialogProps) {
  const [typed, setTyped] = useState("");
  const confirmed = typed === FORGET_CONFIRM_PHRASE;

  const handleOpenChange = (next: boolean) => {
    if (!next) setTyped("");
    onOpenChange(next);
  };

  return (
    <Dialog open={drive != null} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{drive ? `Forget "${drive.name}"` : "Forget drive"}</DialogTitle>
        </DialogHeader>

        <p className="text-[13px] text-muted-foreground">
          {mediaCount == null
            ? "Checking how many photos are in the catalog for this drive…"
            : `Removes ${mediaCount} photo${mediaCount === 1 ? "" : "s"} from the catalog and all their tags/places; files on the drive itself are NEVER touched.`}
        </p>
        <p className="text-[13px] text-muted-foreground">
          Thumbnails already generated for those photos stay in the local thumbnail store — they may be
          shared with other drives, so nothing is deleted from disk here.
        </p>
        {error && <p className="font-mono text-[11px] text-red-400">{error}</p>}

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] tracking-[1.5px] text-faint">
            {`TYPE ${FORGET_CONFIRM_PHRASE} TO CONFIRM`}
          </span>
          <Input
            aria-label={`Type ${FORGET_CONFIRM_PHRASE} to confirm`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={forgetting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!confirmed || forgetting || mediaCount == null}
            onClick={onConfirm}
          >
            {forgetting ? "Forgetting…" : "Forget drive"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
