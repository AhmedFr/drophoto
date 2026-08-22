import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type SortOption, useGalleryStore } from "../../store/galleryStore";

const SORT_OPTIONS: SortOption[] = ["NEWEST", "OLDEST", "ADDED"];

export function SortMenu() {
  const sort = useGalleryStore((s) => s.sort);
  const setSort = useGalleryStore((s) => s.setSort);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="border border-border-2 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground hover:border-border-3 hover:text-foreground">
        {sort} ▾
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SORT_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option}
            className="font-mono text-[10px]"
            onSelect={() => setSort(option)}
          >
            {option}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
