import { cn } from "@/lib/utils";
import { KIND_FILTERS } from "./KindChips.constants";
import type { KindChipsProps } from "./KindChips.types";

/**
 * Local copy of the gallery's `TypeChips` pattern (same look, same
 * pressed/hover styling) — that component reads/writes `useGalleryStore`
 * directly, so it isn't reusable here where the filter is local state over
 * an already-fetched result set rather than a server-side query filter.
 */
export function KindChips({ value, onChange }: KindChipsProps) {
  return (
    <div className="flex">
      {KIND_FILTERS.map((filter) => {
        const active = filter === value;
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(filter)}
            className={cn(
              "-ml-px border px-[11px] py-1.5 font-mono text-[9.5px] tracking-[0.8px] first:ml-0",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border-2 text-muted-foreground hover:bg-surface hover:text-foreground",
            )}
          >
            {filter}
          </button>
        );
      })}
    </div>
  );
}
