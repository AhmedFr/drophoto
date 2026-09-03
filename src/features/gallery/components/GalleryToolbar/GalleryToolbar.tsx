import { DensityToggle } from "./DensityToggle";
import type { GalleryToolbarProps } from "./GalleryToolbar.types";
import { MissingChip } from "./MissingChip";
import { SearchBox } from "./SearchBox";
import { SortMenu } from "./SortMenu";
import { TypeChips } from "./TypeChips";

export function GalleryToolbar({ count }: GalleryToolbarProps) {
  return (
    <div className="flex items-center gap-3">
      <SearchBox />
      <TypeChips />
      <MissingChip />
      <SortMenu />
      <DensityToggle />
      {count !== undefined && (
        <span className="inline-block min-w-[12ch] text-right font-mono text-[10px] text-faint tabular-nums">
          {count} items
        </span>
      )}
    </div>
  );
}
