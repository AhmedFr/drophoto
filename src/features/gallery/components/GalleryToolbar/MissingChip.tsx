import { cn } from "@/lib/utils";
import { useMissingCount } from "../../hooks/useMissingCount";
import { useGalleryStore } from "../../store/galleryStore";

/**
 * Toggles the grid between its normal view and a missing-only view — only
 * rendered once there's at least one missing row anywhere in the catalog
 * (`useMissingCount`), so a library with nothing missing never shows a
 * dead-end toggle.
 */
export function MissingChip() {
  const count = useMissingCount();
  const missingOnly = useGalleryStore((s) => s.missingOnly);
  const setMissingOnly = useGalleryStore((s) => s.setMissingOnly);

  if (!count) return null;

  return (
    <button
      type="button"
      aria-pressed={missingOnly}
      onClick={() => setMissingOnly(!missingOnly)}
      className={cn(
        "border px-[11px] py-1.5 font-mono text-[9.5px] tracking-[0.8px]",
        missingOnly
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border-2 text-muted-foreground hover:bg-surface hover:text-foreground",
      )}
    >
      {`Missing (${count})`}
    </button>
  );
}
