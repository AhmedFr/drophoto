import { X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { listTags } from "@/lib/api/tags";
import { useGalleryStore } from "../../store/galleryStore";

/**
 * The active tag filter, shown as a removable chip once the Tags page has
 * navigated here with one set (`useGalleryStore`'s `tagId`) — mirrors
 * `MissingChip`'s "render nothing until there's something to show" shape.
 * Resolves the id to a name via the same `["tags"]` query `TagPanel`/
 * `useTags` already populate, so this rarely fires its own request.
 */
export function TagFilterChip() {
  const tagId = useGalleryStore((s) => s.tagId);
  const setTagId = useGalleryStore((s) => s.setTagId);

  const tagsQuery = useQuery({ queryKey: ["tags"], queryFn: listTags, enabled: tagId !== null });
  const tag = tagsQuery.data?.find((t) => t.id === tagId);

  if (tagId === null) return null;

  // While the tag list is still loading (or the id no longer resolves to a
  // tag, e.g. it was just deleted elsewhere), fall back to the raw id
  // rather than rendering nothing — the filter is still active and the
  // grid is still restricted by it.
  const label = tag?.name ?? `#${tagId}`;

  return (
    <span className="flex items-center gap-1.5 border border-primary bg-primary px-[11px] py-1.5 font-mono text-[9.5px] tracking-[0.8px] text-primary-foreground">
      {`Tag: ${label}`}
      <button
        type="button"
        aria-label="Clear tag filter"
        onClick={() => setTagId(null)}
        className="text-primary-foreground/70 hover:text-primary-foreground"
      >
        <X size={11} />
      </button>
    </span>
  );
}
