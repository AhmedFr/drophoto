import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format/bytes";
import type { RelinkDriveDialogProps } from "./RelinkDriveDialog.types";

export function RelinkDriveDialog({
  drive,
  candidates,
  relinking,
  error,
  onOpenChange,
  onConfirm,
}: RelinkDriveDialogProps) {
  return (
    <Dialog open={drive != null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{drive ? `Relink "${drive.name}"` : "Relink drive"}</DialogTitle>
        </DialogHeader>

        <p className="text-[13px] text-muted-foreground">
          Pick the mounted volume this drive is now — its catalog history (photos, tags, organize
          history) stays exactly as it is; only the drive&apos;s stored identity is updated.
        </p>
        {error && <p className="font-mono text-[11px] text-red-400">{error}</p>}

        {candidates.length === 0 ? (
          <p className="px-1 py-3 font-mono text-[11px] text-faint">
            No unclaimed mounted volumes found. Plug in the drive and try again.
          </p>
        ) : (
          <ul className="flex flex-col">
            {candidates.map((v) => (
              <li
                key={v.mount_path}
                className="flex items-center gap-4 border-b border-border px-1 py-3 last:border-b-0"
              >
                <span className="text-[14px] font-medium">{v.name || v.mount_path}</span>
                <span className="font-mono text-[10px] text-dim">{v.mount_path}</span>
                <span className="flex-1" />
                <span className="font-mono text-[10px] text-muted-foreground">
                  {formatBytes(v.free_bytes)} free / {formatBytes(v.total_bytes)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={relinking}
                  onClick={() => onConfirm(v.mount_path)}
                >
                  {relinking ? "Relinking…" : "Relink"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
