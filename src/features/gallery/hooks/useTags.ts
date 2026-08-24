import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listTags, tagMedia, tagsForMedia } from "@/lib/api/tags";
import { startSidecarSyncAll } from "@/lib/api/sidecars";

/**
 * Drives tag state for a set of media ids: the full tag list, each tag's
 * coverage over `mediaIds` ("all" every id has it, "some" only part do,
 * absent from the map means none do), and a mutation to apply staged
 * add/remove changes.
 *
 * A successful apply invalidates `["tags"]` (the tag list may have grown),
 * `["media-tags"]` (every cached coverage query, not just this hook's own
 * `mediaIds`), `["media"]` (thumbnails/metadata panels reading tags), and
 * `["search"]` (a tag is indexed text — `useSearch` — so a changed tag set
 * can change which searches find these ids), then fire-and-forgets a
 * sidecar sync sweep — its result isn't surfaced here, only that a
 * mutation succeeded needs one queued.
 */
export function useTags(mediaIds: number[]) {
  const queryClient = useQueryClient();

  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: listTags,
  });

  // Sorted only for the cache key, so selecting the same ids in a different
  // order (e.g. a different shift-click direction) hits the same cache
  // entry instead of firing a redundant query. `mediaIds` itself keeps
  // insertion order everywhere else (the coverage derivation below, and the
  // `tagMedia` call in `applyMutation`).
  const mediaTagsKey = [...mediaIds].sort((a, b) => a - b);

  const mediaTagsQuery = useQuery({
    queryKey: ["media-tags", mediaTagsKey],
    queryFn: () => tagsForMedia(mediaIds),
    enabled: mediaIds.length > 0,
  });

  const states = useMemo(() => {
    const result: Record<number, "all" | "some"> = {};
    if (!mediaTagsQuery.data || mediaIds.length === 0) return result;

    const mediaIdsByTag = new Map<number, Set<number>>();
    for (const [mediaId, tag] of mediaTagsQuery.data) {
      const set = mediaIdsByTag.get(tag.id) ?? new Set<number>();
      set.add(mediaId);
      mediaIdsByTag.set(tag.id, set);
    }

    for (const [tagId, coveredIds] of mediaIdsByTag) {
      result[tagId] = coveredIds.size === mediaIds.length ? "all" : "some";
    }
    return result;
  }, [mediaTagsQuery.data, mediaIds]);

  const applyMutation = useMutation({
    mutationFn: (input: { add: string[]; remove: number[] }) =>
      tagMedia({ mediaIds, add: input.add, remove: input.remove }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      queryClient.invalidateQueries({ queryKey: ["media-tags"] });
      queryClient.invalidateQueries({ queryKey: ["media"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
      startSidecarSyncAll().catch(() => {});
    },
  });

  return {
    allTags: tagsQuery.data ?? [],
    states,
    apply: applyMutation.mutate,
    isApplying: applyMutation.isPending,
    error: applyMutation.isError ? (applyMutation.error as Error).message : null,
  };
}
