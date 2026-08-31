import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ResetAppDataDialog } from "../ResetAppDataDialog";
import { UninstallDialog } from "../UninstallDialog";
import type { DangerZoneProps } from "./DangerZone.types";

export function DangerZone({
  onConfirmReset,
  resetting,
  resetError,
  onConfirmUninstall,
  uninstalling,
  uninstallError,
}: DangerZoneProps) {
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [uninstallDialogOpen, setUninstallDialogOpen] = useState(false);

  return (
    <div className="mx-6 mt-2 mb-6 flex flex-col gap-3 rounded-md border border-red-900/60 p-4">
      <div className="font-mono text-[9px] tracking-[2px] text-red-400">DANGER ZONE</div>
      <p className="text-[12px] text-muted-foreground">
        Reset app data permanently deletes the catalog and every cached thumbnail on this computer. Uninstall
        does that too, and also moves drophoto itself to the Trash. Your photos, folders, and .xmp sidecar files
        on your drives are never touched by either.
      </p>
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" onClick={() => setResetDialogOpen(true)}>
          Reset app data…
        </Button>
        <Button variant="destructive" size="sm" onClick={() => setUninstallDialogOpen(true)}>
          Uninstall drophoto…
        </Button>
      </div>

      <ResetAppDataDialog
        open={resetDialogOpen}
        onOpenChange={setResetDialogOpen}
        onConfirm={onConfirmReset}
        resetting={resetting}
        error={resetError}
      />

      <UninstallDialog
        open={uninstallDialogOpen}
        onOpenChange={setUninstallDialogOpen}
        onConfirm={onConfirmUninstall}
        uninstalling={uninstalling}
        error={uninstallError}
      />
    </div>
  );
}
