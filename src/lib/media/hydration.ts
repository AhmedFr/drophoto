import type { MediaItem } from "@/lib/api/media";

/**
 * The hydrated row at `index`, but only when it really is the photo the
 * timeline says belongs there — otherwise `undefined`, exactly as if it
 * had not loaded yet.
 *
 * The timeline index (ids and geometry) and the hydrated rows are cached
 * and refetched independently. Any `invalidateQueries({ queryKey:
 * ["media"] })` in the app — a scan, a tag or place edit, a missing-file
 * reconcile, a date recovery — refetches both, and whichever lands first
 * leaves position N meaning two different photos on the two sides. The
 * filters haven't changed in that window, so nothing coarser than an id
 * comparison can see it.
 *
 * Every surface that turns a position into a *photo* has to go through
 * this, not just the ones that draw: opening a lightbox, and the tag and
 * place panels it hosts, act on `row.id`, and a tag write sets
 * `sidecar_pending` — so a row read from the wrong position eventually
 * reaches a real `.xmp` file on disk. `Tile` makes the same comparison
 * inline, against the single entry it already holds.
 */
export function rowAt(
  items: (MediaItem | undefined)[],
  ids: number[],
  index: number,
): MediaItem | undefined {
  const item = items[index];
  return item !== undefined && item.row.id === ids[index] ? item : undefined;
}
