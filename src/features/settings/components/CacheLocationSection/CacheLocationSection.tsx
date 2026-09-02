import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { pickFolder } from "@/lib/api/dialog";
import { cacheStatus, moveCache } from "@/lib/api/settings";
import { relaunchApp } from "@/lib/api/updater";

/**
 * Settings' "Cache location" row: where thumbnails/previews live, with a
 * CHANGE… flow that picks a folder, confirms, moves the cache into
 * `<folder>/drophoto-thumbs`, and relaunches the app (the running process
 * keeps its old store, so a relaunch — not a hot swap — is how the new
 * location takes effect; `move_cache`'s doc comment owns the details).
 * Also warns when the configured location was unusable at startup (its
 * drive unplugged, say) and the app fell back to the default for this
 * launch.
 */
export function CacheLocationSection() {
  const statusQuery = useQuery({
    // A startup snapshot on the Rust side (same idea as `tool-health`) —
    // it only ever changes via the relaunch this section itself triggers.
    queryKey: ["cache-status"],
    queryFn: cacheStatus,
    staleTime: Infinity,
  });
  const status = statusQuery.data ?? null;

  // The folder the user picked, while the confirm dialog is open.
  const [pickedDir, setPickedDir] = useState<string | null>(null);
  // Set only if the move succeeded but the relaunch itself failed — kept
  // separate from `moveMutation.error`, which would wrongly suggest the
  // move (not the relaunch) needs retrying.
  const [relaunchError, setRelaunchError] = useState(false);

  const moveMutation = useMutation({
    mutationFn: moveCache,
    onSuccess: async () => {
      // The setting is persisted; only a fresh process reads it. Await
      // (rather than fire-and-forget) so a relaunch failure — the app
      // stays running with a `ThumbStore` pointing at a directory that no
      // longer exists — surfaces instead of leaving the dialog silently
      // open forever.
      setRelaunchError(false);
      try {
        await relaunchApp();
      } catch {
        setRelaunchError(true);
      }
    },
  });

  async function handleChange() {
    const dir = await pickFolder();
    if (dir !== null) setPickedDir(dir);
  }

  function handleDialogChange(open: boolean) {
    if (!open) {
      setPickedDir(null);
      setRelaunchError(false);
      moveMutation.reset();
    }
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center px-6 pt-5 pb-2">
        <span className="font-mono text-[9px] tracking-[2px] text-faint">CACHE LOCATION</span>
      </div>

      {statusQuery.error && (
        <p className="px-6 pb-2 font-mono text-[11px] text-red-400">
          {(statusQuery.error as Error).message}
        </p>
      )}

      {status ? (
        <div className="flex flex-col gap-2 px-6 pb-6">
          <div className="flex items-center gap-3">
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={status.thumbs_dir}>
              {status.thumbs_dir}
            </span>
            <span className="flex-1" />
            <Button variant="outline" size="xs" onClick={handleChange}>
              Change…
            </Button>
          </div>
          {status.fallback && (
            <p className="font-mono text-[10px] text-yellow-400">
              The configured cache location was unavailable at launch — using the default for now.
              Plug the cache drive back in and relaunch to restore it.
            </p>
          )}
        </div>
      ) : (
        <p className="px-6 pb-6 font-mono text-[11px] text-faint">
          {statusQuery.isLoading ? "Checking cache location…" : "Cache location unavailable."}
        </p>
      )}

      <Dialog open={pickedDir !== null} onOpenChange={handleDialogChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move thumbnail cache</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground">
            Moves every cached thumbnail into{" "}
            <span className="font-mono text-[12px]">{pickedDir}/drophoto-thumbs</span> and relaunches
            drophoto. Your photos and .xmp sidecar files are never touched.
          </p>
          {moveMutation.error && (
            <p className="font-mono text-[11px] text-red-400">{(moveMutation.error as Error).message}</p>
          )}
          {relaunchError && (
            <p className="font-mono text-[11px] text-red-400">
              Cache moved, but drophoto couldn't relaunch automatically — quit and reopen drophoto manually to
              finish.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => handleDialogChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => pickedDir !== null && moveMutation.mutate(pickedDir)}
              disabled={moveMutation.isPending}
            >
              {moveMutation.isPending ? "Moving…" : "Move and relaunch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
