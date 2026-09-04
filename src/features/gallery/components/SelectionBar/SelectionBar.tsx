import { Button } from "@/components/ui/button";
import type { SelectionBarProps } from "./SelectionBar.types";

export function SelectionBar({
  count,
  total,
  onTag,
  onPlace,
  onClear,
  onSelectAll,
  onInvert,
}: SelectionBarProps) {
  if (count === 0) return null;

  return (
    <div className="flex items-center gap-4 border-t border-border bg-background px-[22px] py-3">
      <span className="font-mono text-[10px] tracking-[1.5px] text-faint">{count} SELECTED</span>
      {/*
        "LOADED" (not "of the library"/"total") — paging is infinite, so
        `total` is only what's paged into the grid so far, same honesty
        constraint as ⌘A/SELECT ALL below.
      */}
      <span className="font-mono text-[10px] tracking-[1.5px] text-faint">{total} LOADED</span>
      <div className="flex-1" />
      <Button
        variant="outline"
        size="sm"
        className="font-mono text-[10.5px] tracking-[1.5px]"
        onClick={onSelectAll}
        title={`Select all ${total} loaded items`}
      >
        SELECT ALL
      </Button>
      <Button variant="outline" size="sm" className="font-mono text-[10.5px] tracking-[1.5px]" onClick={onInvert}>
        INVERT
      </Button>
      <Button variant="outline" size="sm" className="font-mono text-[10.5px] tracking-[1.5px]" onClick={onTag}>
        TAG
      </Button>
      <Button variant="outline" size="sm" className="font-mono text-[10.5px] tracking-[1.5px]" onClick={onPlace}>
        PLACE
      </Button>
      <Button variant="outline" size="sm" className="font-mono text-[10.5px] tracking-[1.5px]" onClick={onClear}>
        CLEAR
      </Button>
    </div>
  );
}
