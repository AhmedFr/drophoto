import { ImageOff, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { thumbUrl } from "@/lib/media/thumbUrl";
import type { AlbumCardProps } from "./AlbumCard.types";

/**
 * One tag on the Tags page, rendered as a Google-Photos-style album card:
 * a square cover crop, the tag name, and its photo count. The whole card
 * is a single `button` (opens the gallery filtered to this tag); rename/
 * merge/delete live behind a hover-revealed overflow menu in the corner
 * so they never compete with the open action for the click.
 */
export function AlbumCard({ card, onOpen, onRename, onMerge, onDelete }: AlbumCardProps) {
  const { tag, count, thumb_path, has_thumb } = card;

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-col gap-2 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <div className="relative aspect-square overflow-hidden rounded-md bg-surface-2">
          {has_thumb && thumb_path ? (
            <img
              loading="lazy"
              alt={tag.name}
              src={thumbUrl(thumb_path)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              aria-label="No preview"
              className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-surface-2 text-dim"
            >
              <ImageOff size={20} strokeWidth={1.5} />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-0.5 px-0.5">
          <span className="truncate text-[13px] font-medium text-foreground">{tag.name}</span>
          <span className="font-mono text-[10.5px] text-dim tabular-nums">{count}</span>
        </div>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Tag actions"
            className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-md bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onRename}>Rename…</DropdownMenuItem>
          <DropdownMenuItem onSelect={onMerge}>Merge into…</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
