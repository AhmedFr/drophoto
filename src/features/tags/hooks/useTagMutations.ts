import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteTag, mergeTags, renameTag } from "@/lib/api/tags";
import { startSidecarSyncAll } from "@/lib/api/sidecars";

/**
 * Rename/merge/delete mutations for the Tags page, sharing one
 * invalidation shape — every one of these can change which tags exist,
 * how many photos each carries, and what photos/search results show, so
 * every one invalidates the same set of query keys (mirroring
 * `useTags`'s `applyMutation`, which does the same for `tag_media`):
 * `["tags"]`/`["tags-with-counts"]` (the tag itself changed), `["media-tags"]`
 * (every cached per-media coverage query), `["media"]`/`["media-count"]`
 * (the gallery, including any active tag filter), and `["search"]` (a tag
 * is indexed text). A successful mutation also fire-and-forgets a sidecar
 * sync sweep, same as `useTags`.
 */
export function useTagMutations() {
  const queryClient = useQueryClient();

  function invalidateAfterMutation() {
    queryClient.invalidateQueries({ queryKey: ["tags"] });
    queryClient.invalidateQueries({ queryKey: ["tags-with-counts"] });
    queryClient.invalidateQueries({ queryKey: ["media-tags"] });
    queryClient.invalidateQueries({ queryKey: ["media"] });
    queryClient.invalidateQueries({ queryKey: ["media-count"] });
    queryClient.invalidateQueries({ queryKey: ["search"] });
    startSidecarSyncAll().catch(() => {});
  }

  const renameMutation = useMutation({ mutationFn: renameTag, onSuccess: invalidateAfterMutation });
  const mergeMutation = useMutation({ mutationFn: mergeTags, onSuccess: invalidateAfterMutation });
  const deleteMutation = useMutation({ mutationFn: deleteTag, onSuccess: invalidateAfterMutation });

  return {
    rename: renameMutation.mutate,
    isRenaming: renameMutation.isPending,
    renameError: renameMutation.isError ? (renameMutation.error as Error).message : null,
    resetRename: renameMutation.reset,

    merge: mergeMutation.mutate,
    isMerging: mergeMutation.isPending,
    mergeError: mergeMutation.isError ? (mergeMutation.error as Error).message : null,
    resetMerge: mergeMutation.reset,

    remove: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
    deleteError: deleteMutation.isError ? (deleteMutation.error as Error).message : null,
    resetDelete: deleteMutation.reset,
  };
}
