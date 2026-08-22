import { useState, type MouseEvent } from "react";
import type { MediaItem } from "@/lib/api/media";
import { basename } from "@/lib/media/format";
import { thumbUrl } from "@/lib/media/thumbUrl";

/**
 * Shows `item`'s 2000px preview, falling back to its thumbnail if the
 * preview fails to load. Render with `key={item.row.id}` so the fallback
 * state resets when the current item changes, instead of carrying a stale
 * `errored` flag over from the previous image.
 */
export function LightboxImage({ item }: { item: MediaItem }) {
  const [errored, setErrored] = useState(false);
  const src = errored ? thumbUrl(item.thumb_path) : thumbUrl(item.preview_path);

  return (
    <img
      src={src}
      alt={basename(item.row.rel_path)}
      className="max-h-full max-w-full object-contain"
      onClick={(e: MouseEvent) => e.stopPropagation()}
      onError={() => setErrored(true)}
    />
  );
}
