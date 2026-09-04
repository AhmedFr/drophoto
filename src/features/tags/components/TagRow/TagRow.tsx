import { Button } from "@/components/ui/button";
import type { TagRowProps } from "./TagRow.types";

/** One tag row on the Tags page: name (opens the gallery filtered to it), photo count, and per-row actions. */
export function TagRow({ tagWithCount, onOpen, onRename, onMerge, onDelete }: TagRowProps) {
  const { tag, count } = tagWithCount;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0">
      <button
        type="button"
        onClick={() => onOpen(tag.id)}
        className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-foreground hover:underline"
      >
        {tag.name}
      </button>
      <span className="shrink-0 font-mono text-[10.5px] text-dim tabular-nums">
        {count} {count === 1 ? "photo" : "photos"}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="xs" onClick={() => onRename(tagWithCount)}>
          RENAME
        </Button>
        <Button variant="ghost" size="xs" onClick={() => onMerge(tagWithCount)}>
          MERGE INTO…
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="text-destructive hover:text-destructive"
          onClick={() => onDelete(tagWithCount)}
        >
          DELETE
        </Button>
      </div>
    </div>
  );
}
