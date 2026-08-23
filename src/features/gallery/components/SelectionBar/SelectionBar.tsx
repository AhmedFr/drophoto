import { Button } from "@/components/ui/button";
import type { SelectionBarProps } from "./SelectionBar.types";

export function SelectionBar({ count, onTag, onClear }: SelectionBarProps) {
  if (count === 0) return null;

  return (
    <div className="flex items-center gap-4 border-t border-border bg-background px-[22px] py-3">
      <span className="font-mono text-[10px] tracking-[1.5px] text-faint">{count} SELECTED</span>
      <div className="flex-1" />
      <Button variant="outline" size="sm" className="font-mono text-[10.5px] tracking-[1.5px]" onClick={onTag}>
        TAG
      </Button>
      <Button variant="outline" size="sm" className="font-mono text-[10.5px] tracking-[1.5px]" onClick={onClear}>
        CLEAR
      </Button>
    </div>
  );
}
