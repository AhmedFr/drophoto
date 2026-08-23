import { useState, type MouseEvent } from "react";
import { ImageOff } from "lucide-react";
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

  if (!item.has_thumb) {
    return (
      <div
        aria-label="No preview"
        onClick={(e: MouseEvent) => e.stopPropagation()}
        className="flex h-64 w-64 max-h-full max-w-full flex-col items-center justify-center gap-2 bg-surface-2 text-dim"
      >
        <ImageOff size={32} strokeWidth={1.5} />
        <span className="font-mono text-[11px] tracking-[1px]">{item.row.ext.toUpperCase()}</span>
      </div>
    );
  }

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
