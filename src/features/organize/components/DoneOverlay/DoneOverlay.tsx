import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import type { router } from "@/app/router";
import { Button } from "@/components/ui/button";
import type { DoneOverlayProps } from "./DoneOverlay.types";

function foldersLine(folders: string[]): string {
  if (folders.length === 0) return "—";
  const shown = folders.slice(0, 3);
  const extra = folders.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} +${extra} more` : shown.join(", ");
}

export function DoneOverlay({ moved, skipped, failed, fileTpl, folders }: DoneOverlayProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background">
      <div className="flex size-14 items-center justify-center border border-border-3">
        <Check className="size-6" aria-hidden />
      </div>
      <span className="font-mono text-[10px] tracking-[3px] text-dim">ORGANIZED</span>
      <h1 className="text-[38px] font-semibold">{moved} photos filed</h1>
      <div className="flex flex-col items-center gap-1 font-mono text-[12px] text-muted-foreground">
        <span>Renamed to {fileTpl}</span>
        <span>Filed into {foldersLine(folders)}</span>
        <span>
          {skipped} skipped · {failed} failed
        </span>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button asChild size="sm" className="font-mono text-[10.5px] tracking-[1.5px]">
          <Link<typeof router, string, string> to="/gallery">OPEN GALLERY →</Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="font-mono text-[10.5px] tracking-[1.5px]">
          <Link<typeof router, string, string> to="/">DASHBOARD</Link>
        </Button>
      </div>
    </div>
  );
}
