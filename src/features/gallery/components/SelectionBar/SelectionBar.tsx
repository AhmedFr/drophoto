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
        "IN VIEW", not "LOADED": the timeline index covers the whole
        filtered set, so `total` is every match — including the ones whose
        rows haven't been hydrated — rather than what has been paged in.
        Not "TOTAL" either, which would over-claim whenever a filter,
        search or tag is narrowing the view. ⌘A / SELECT ALL / INVERT all
        cover exactly this number.
      */}
      <span className="font-mono text-[10px] tracking-[1.5px] text-faint">{total} IN VIEW</span>
      <div className="flex-1" />
      <Button
        variant="outline"
        size="sm"
        className="font-mono text-[10.5px] tracking-[1.5px]"
        onClick={onSelectAll}
        title={`Select all ${total} items in this view`}
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
