import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ResetAppDataDialog } from "../ResetAppDataDialog";
import type { DangerZoneProps } from "./DangerZone.types";

export function DangerZone({ onConfirmReset, resetting, resetError }: DangerZoneProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="mx-6 mt-2 mb-6 flex flex-col gap-3 rounded-md border border-red-900/60 p-4">
      <div className="font-mono text-[9px] tracking-[2px] text-red-400">DANGER ZONE</div>
      <p className="text-[12px] text-muted-foreground">
        Permanently deletes the catalog and every cached thumbnail on this computer. Your photos, folders, and
        .xmp sidecar files on your drives are never touched.
      </p>
      <div>
        <Button variant="destructive" size="sm" onClick={() => setDialogOpen(true)}>
          Reset app data…
        </Button>
      </div>

      <ResetAppDataDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConfirm={onConfirmReset}
        resetting={resetting}
        error={resetError}
      />
    </div>
  );
}
