import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { router } from "@/app/router";
import { DotLoader } from "@/components/DotLoader";
import { PageHeader } from "@/components/PageHeader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGalleryStore } from "@/features/gallery/store/galleryStore";
import type { Tag, TagCard as TagCardData, TagWithCount } from "@/lib/api/tags";
import { AlbumCard } from "./components/AlbumCard";
import { DeleteTagDialog } from "./components/DeleteTagDialog";
import { MergeTagDialog } from "./components/MergeTagDialog";
import { RenameTagDialog } from "./components/RenameTagDialog";
import { useTagsWithCounts } from "./hooks/useTagsWithCounts";

type SortOption = "RECENT" | "NAME" | "COUNT";
const SORT_OPTIONS: SortOption[] = ["RECENT", "NAME", "COUNT"];
const SORT_LABELS: Record<SortOption, string> = {
  RECENT: "Recently updated",
  NAME: "Name",
  COUNT: "Count",
};

function byName(a: TagCardData, b: TagCardData): number {
  return a.tag.name.localeCompare(b.tag.name, undefined, { sensitivity: "base" });
}

/**
 * `RECENT`'s comparator: newest `cover_taken_at` first. The server's own
 * row order is alphabetical by name regardless of `cover_taken_at` (see
 * `TagCard`'s doc comment) — it is *not* recency order — so this is a
 * genuine client-side sort, the same as `NAME`/`COUNT`, not a pass-through.
 * A tag with no cover (`cover_taken_at: null`) sorts after every dated
 * tag; when both sides are undated, or tie on the same instant, `byName`
 * breaks the tie so the order stays deterministic across renders.
 */
function byRecency(a: TagCardData, b: TagCardData): number {
  if (a.cover_taken_at == null && b.cover_taken_at == null) return byName(a, b);
  if (a.cover_taken_at == null) return 1;
  if (b.cover_taken_at == null) return -1;
  const diff = Date.parse(b.cover_taken_at) - Date.parse(a.cover_taken_at);
  return diff !== 0 ? diff : byName(a, b);
}

/** Orders `cards` for the grid — a client-side sort in every case, over the whole (already in-memory) fetched list. */
function sortCards(cards: TagCardData[], sort: SortOption): TagCardData[] {
  const sorted = [...cards];
  if (sort === "RECENT") sorted.sort(byRecency);
  else if (sort === "NAME") sorted.sort(byName);
  else sorted.sort((a, b) => b.count - a.count);
  return sorted;
}

const EMPTY_CARDS: TagCardData[] = [];

export function TagsPage() {
  const navigate = useNavigate();
  const setTagId = useGalleryStore((s) => s.setTagId);
  const tagsQuery = useTagsWithCounts();
  const cards = tagsQuery.data ?? EMPTY_CARDS;
  const [sort, setSort] = useState<SortOption>("RECENT");
  const sortedCards = useMemo(() => sortCards(cards, sort), [cards, sort]);

  const [renamingTag, setRenamingTag] = useState<Tag | null>(null);
  const [mergingTag, setMergingTag] = useState<Tag | null>(null);
  const [deletingTag, setDeletingTag] = useState<TagWithCount | null>(null);

  // The Tags page navigates to the gallery through the store (a plain
  // `setTagId` before navigating), not route state — the simpler of the
  // two options the brief allows: `GalleryPage` already reads its tag
  // filter from `useGalleryStore` for the toolbar chip/query, so route
  // state would mean threading the id through the router just to shovel it
  // right back into the same store on mount.
  function openInGallery(tagId: number) {
    setTagId(tagId);
    // The feature registry (`src/app/registry.ts`) types each module's
    // route `path` as a plain `string`, so the router's generated route
    // tree loses literal path types and can't type-check `to` against the
    // app's real routes — same reason `GalleryPage`'s empty-state `Link`
    // widens its own generics instead of relying on inference. `navigate`
    // is a generic function value (not a component), so the widening
    // happens as an explicit type argument at the call site instead of via
    // JSX generics.
    navigate<typeof router, string>({ to: "/gallery" });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Tags">
        {cards.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger className="border border-border-2 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground hover:border-border-3 hover:text-foreground">
              {SORT_LABELS[sort]} <span aria-hidden="true">▾</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SORT_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option}
                  className="font-mono text-[10px]"
                  onSelect={() => setSort(option)}
                >
                  {SORT_LABELS[option]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </PageHeader>
      <div className="flex-1 overflow-y-auto p-5">
        {tagsQuery.isLoading && <DotLoader label="Loading tags…" />}
        {tagsQuery.isError && (
          <p className="font-mono text-[11px] text-red-400">{(tagsQuery.error as Error).message}</p>
        )}
        {tagsQuery.isSuccess && cards.length === 0 && (
          <p className="font-mono text-[11px] text-faint">
            No tags yet — tag photos from the gallery to see them here.
          </p>
        )}
        {sortedCards.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            {sortedCards.map((card) => (
              <AlbumCard
                key={card.tag.id}
                card={card}
                onOpen={() => openInGallery(card.tag.id)}
                onRename={() => setRenamingTag(card.tag)}
                onMerge={() => setMergingTag(card.tag)}
                onDelete={() => setDeletingTag({ tag: card.tag, count: card.count })}
              />
            ))}
          </div>
        )}
      </div>

      <RenameTagDialog tag={renamingTag} onClose={() => setRenamingTag(null)} />
      <MergeTagDialog
        tag={mergingTag}
        allTags={cards.map((c) => c.tag)}
        onClose={() => setMergingTag(null)}
      />
      <DeleteTagDialog tagWithCount={deletingTag} onClose={() => setDeletingTag(null)} />
    </div>
  );
}
