import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { DotLoader } from "@/components/DotLoader";
import { Lightbox } from "@/features/gallery/components/Lightbox";
import { VirtualGrid } from "@/features/gallery/components/VirtualGrid";
import { DENSITY_ROW_HEIGHT } from "@/features/gallery/store/galleryStore";
import { KindChips } from "./components/KindChips";
import type { SearchKindFilter } from "./components/KindChips";
import { SearchInput } from "./components/SearchInput";
import { useSearch } from "./hooks/useSearch";

// A search's results are never paged (capped server-side, see
// `SEARCH_LIMIT_CAP`), so there's no density toggle here — just the
// gallery's normal ("Comfortable") row height, reused rather than
// re-declaring the same number.
const ROW_HEIGHT = DENSITY_ROW_HEIGHT.Comfortable;

const EMPTY_SELECTION = new Set<number>();

// Search results support plain-click-to-open only (no multi-select in this
// phase) — `VirtualGrid` still requires an `onToggle`, so this is the
// no-op passed for it.
function noopToggle() {}

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<SearchKindFilter>("ALL");
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const { items, isFetching, isDebouncing } = useSearch(query);

  const filteredItems = useMemo(() => {
    if (kindFilter === "ALL") return items;
    const kind = kindFilter === "PHOTOS" ? "photo" : "video";
    return items.filter((item) => item.row.kind === kind);
  }, [items, kindFilter]);

  const trimmedQuery = query.trim();
  const isEmptyQuery = trimmedQuery === "";
  // M5: the loader only ever covers the "nothing to show yet" case —
  // `useSearch` already keeps a non-empty previous result set as `items`
  // while debouncing/refetching, so `filteredItems.length === 0` is the
  // real gate here, same as `useSearch`'s own `isFetching` reasoning.
  const isLoading = !isEmptyQuery && filteredItems.length === 0 && (isDebouncing || isFetching);
  const hasResults = !isEmptyQuery && !isLoading && filteredItems.length > 0;
  const hasNoResults = !isEmptyQuery && !isLoading && filteredItems.length === 0;

  // Results can shrink out from under an open lightbox (switching the kind
  // filter, or a query edit while it's still open) — clamp instead of
  // leaving a stale, out-of-range index. See `GalleryPage` for the same
  // pattern in more detail.
  const [prevLength, setPrevLength] = useState(filteredItems.length);
  if (filteredItems.length !== prevLength) {
    setPrevLength(filteredItems.length);
    if (openIndex !== null && openIndex >= filteredItems.length) {
      setOpenIndex(filteredItems.length ? filteredItems.length - 1 : null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Search">
        <KindChips value={kindFilter} onChange={setKindFilter} />
      </PageHeader>
      <SearchInput value={query} onChange={setQuery} />
      <div className="flex-1 overflow-hidden">
        {isEmptyQuery && (
          <div className="p-5 font-mono text-[11px] tracking-[0.8px] text-faint">TYPE TO SEARCH</div>
        )}
        {isLoading && (
          <div className="p-5">
            <DotLoader label="Searching…" />
          </div>
        )}
        {hasNoResults && (
          <div className="p-5 font-mono text-[11px] tracking-[0.8px] text-faint">
            NO RESULTS FOR &quot;{trimmedQuery}&quot;
          </div>
        )}
        {hasResults && (
          <div className="flex h-full flex-col">
            <div className="px-5 pt-3 font-mono text-[10px] tracking-[0.8px] text-muted-foreground">
              {filteredItems.length} RESULT{filteredItems.length === 1 ? "" : "S"}
            </div>
            <div className="min-h-0 flex-1">
              <VirtualGrid
                items={filteredItems}
                targetRowHeight={ROW_HEIGHT}
                onOpen={setOpenIndex}
                selectedIds={EMPTY_SELECTION}
                onToggle={noopToggle}
              />
            </div>
          </div>
        )}
      </div>
      {openIndex !== null && (
        <Lightbox
          items={filteredItems}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onPrev={() => setOpenIndex(openIndex > 0 ? openIndex - 1 : openIndex)}
          onNext={() => setOpenIndex(openIndex < filteredItems.length - 1 ? openIndex + 1 : openIndex)}
        />
      )}
    </div>
  );
}
