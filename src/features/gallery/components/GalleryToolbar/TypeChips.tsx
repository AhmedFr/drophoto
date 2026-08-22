import { TYPE_FILTERS } from "@/lib/media/typeFilter";
import { cn } from "@/lib/utils";
import { useGalleryStore } from "../../store/galleryStore";

export function TypeChips() {
  const typeFilter = useGalleryStore((s) => s.typeFilter);
  const setTypeFilter = useGalleryStore((s) => s.setTypeFilter);

  return (
    <div className="flex">
      {TYPE_FILTERS.map((filter) => {
        const active = filter === typeFilter;
        return (
          <button
            key={filter}
            type="button"
            aria-pressed={active}
            onClick={() => setTypeFilter(filter)}
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
