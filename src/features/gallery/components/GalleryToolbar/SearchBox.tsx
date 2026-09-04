import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { useGalleryStore } from "../../store/galleryStore";

/** How long to wait, after the last keystroke, before committing the text to the store — mirrors the deleted Search page's own `useSearch` debounce. */
const DEBOUNCE_MS = 200;

/**
 * The gallery toolbar's search box — folds what used to be a standalone
 * `/search` page into the gallery's one query backend. Keeps its own
 * per-keystroke `value` so typing feels instant, and only commits to
 * `useGalleryStore`'s `query` (which drives the actual `query_media`
 * refetch, see `useMediaInfinite`) once the debounce settles.
 */
export function SearchBox() {
  const storeQuery = useGalleryStore((s) => s.query);
  const setQuery = useGalleryStore((s) => s.setQuery);
  const [value, setValue] = useState(storeQuery);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(value), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, setQuery]);

  // The clear button skips the debounce entirely — an explicit "clear"
  // action should feel instant, not wait out the same delay typing does.
  function handleClear() {
    setValue("");
    setQuery("");
  }

  return (
    <div className="flex max-w-[340px] flex-1 items-center gap-2 border border-border-2 bg-surface px-[11px] py-[7px] font-mono text-[11px] text-dim">
      <Search size={12} className="shrink-0" />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search photos"
        aria-label="Search photos"
        className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-faint"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={handleClear}
          className="shrink-0 text-faint hover:text-foreground"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
