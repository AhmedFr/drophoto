import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Ban, Check } from "lucide-react";
import type { router } from "@/app/router";
import { Button } from "@/components/ui/button";
import { RevertConfirmDialog } from "@/components/RevertConfirmDialog";
import { useWizardStore } from "../../store/wizardStore";
import type { DoneOverlayProps } from "./DoneOverlay.types";

function foldersLine(folders: string[]): string {
  if (folders.length === 0) return "—";
  const shown = folders.slice(0, 3);
  const extra = folders.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} +${extra} more` : shown.join(", ");
}

/** Resets the wizard back to step 0 with nothing selected before a DoneOverlay CTA navigates away. */
function resetWizard() {
  useWizardStore.getState().reset();
}

export function DoneOverlay({
  moved,
  skipped,
  failed,
  fileTpl,
  folders,
  foldersHint,
  cancelled = false,
  onRevert,
  reverting = false,
  revertProgress = null,
  reverted = false,
  revertError = null,
}: DoneOverlayProps) {
  const title = cancelled ? "Cancelled" : "Organized";
  const [confirmOpen, setConfirmOpen] = useState(false);
  const showRevert = moved > 0 && !cancelled && onRevert != null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background"
    >
      <div className="flex size-14 items-center justify-center border border-border-3">
        {cancelled ? <Ban className="size-6" aria-hidden /> : <Check className="size-6" aria-hidden />}
      </div>
      <span className="font-mono text-[10px] tracking-[3px] text-dim">{title.toUpperCase()}</span>
      <h1 className="text-[38px] font-semibold">
        {moved} photos filed{cancelled ? " before cancelling" : ""}
      </h1>
      <div className="flex flex-col items-center gap-1 font-mono text-[12px] text-muted-foreground">
        <span>Renamed to {fileTpl}</span>
        <span>
          Filed into {foldersLine(folders)}
          {foldersHint && <span className="ml-1 text-faint">({foldersHint})</span>}
        </span>
        <span>
          {skipped} skipped · {failed} failed
        </span>
        {cancelled && <span>Remaining photos were left in place.</span>}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button asChild size="sm" className="font-mono text-[10.5px] tracking-[1.5px]">
          <Link<typeof router, string, string> to="/gallery" onClick={resetWizard}>
            OPEN GALLERY →
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="font-mono text-[10.5px] tracking-[1.5px]">
          <Link<typeof router, string, string> to="/" onClick={resetWizard}>
            DASHBOARD
          </Link>
        </Button>
        {showRevert &&
          (reverted ? (
            <span className="font-mono text-[10.5px] tracking-[1.5px] text-faint">REVERTED</span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="font-mono text-[10.5px] tracking-[1.5px]"
              disabled={reverting}
              onClick={() => setConfirmOpen(true)}
            >
              {reverting ? `REVERTING… ${revertProgress?.done ?? 0}/${revertProgress?.total ?? 0}` : "REVERT"}
            </Button>
          ))}
      </div>
      {showRevert && revertError && (
        <p className="font-mono text-[10.5px] text-red-400">{revertError}</p>
      )}
      {showRevert && onRevert && (
        <RevertConfirmDialog
          open={confirmOpen}
          moved={moved}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => {
            setConfirmOpen(false);
            onRevert();
          }}
        />
      )}
    </div>
  );
}
