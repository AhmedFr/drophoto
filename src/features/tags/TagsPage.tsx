import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { router } from "@/app/router";
import { DotLoader } from "@/components/DotLoader";
import { PageHeader } from "@/components/PageHeader";
import { useGalleryStore } from "@/features/gallery/store/galleryStore";
import type { Tag, TagWithCount } from "@/lib/api/tags";
import { DeleteTagDialog } from "./components/DeleteTagDialog";
import { MergeTagDialog } from "./components/MergeTagDialog";
import { RenameTagDialog } from "./components/RenameTagDialog";
import { TagRow } from "./components/TagRow";
import { useTagsWithCounts } from "./hooks/useTagsWithCounts";

export function TagsPage() {
  const navigate = useNavigate();
  const setTagId = useGalleryStore((s) => s.setTagId);
  const tagsQuery = useTagsWithCounts();
  const tagsWithCounts = tagsQuery.data ?? [];

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
      <PageHeader title="Tags" />
      <div className="flex-1 overflow-y-auto p-5">
        {tagsQuery.isLoading && <DotLoader label="Loading tags…" />}
        {tagsQuery.isError && (
          <p className="font-mono text-[11px] text-red-400">{(tagsQuery.error as Error).message}</p>
        )}
        {tagsQuery.isSuccess && tagsWithCounts.length === 0 && (
          <p className="font-mono text-[11px] text-faint">
            No tags yet — tag photos from the gallery to see them here.
          </p>
        )}
        {tagsWithCounts.length > 0 && (
          <div className="flex flex-col">
            {tagsWithCounts.map((tagWithCount) => (
              <TagRow
                key={tagWithCount.tag.id}
                tagWithCount={tagWithCount}
                onOpen={openInGallery}
                onRename={(t) => setRenamingTag(t.tag)}
                onMerge={(t) => setMergingTag(t.tag)}
                onDelete={setDeletingTag}
              />
            ))}
          </div>
        )}
      </div>

      <RenameTagDialog tag={renamingTag} onClose={() => setRenamingTag(null)} />
      <MergeTagDialog
        tag={mergingTag}
        allTags={tagsWithCounts.map((t) => t.tag)}
        onClose={() => setMergingTag(null)}
      />
      <DeleteTagDialog tagWithCount={deletingTag} onClose={() => setDeletingTag(null)} />
    </div>
  );
}
