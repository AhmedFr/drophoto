import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import type { router } from "@/app/router";
import { DensityToggle } from "./DensityToggle";
import type { GalleryToolbarProps } from "./GalleryToolbar.types";
import { MissingChip } from "./MissingChip";
import { SortMenu } from "./SortMenu";
import { TypeChips } from "./TypeChips";

export function GalleryToolbar({ count }: GalleryToolbarProps) {
  return (
    <div className="flex items-center gap-3">
      {/*
        The feature registry (`src/app/registry.ts`) types each module's
        route `path` as a plain `string`, so the router's generated route
        tree loses literal path types and can't type-check `to` against the
        app's real routes (the same reason `Sidebar` navigates with a plain
        `<a>` + `onNavigate` instead of `Link`, and `GalleryPage`'s empty
        state widens the same way for `/drives`). Widening the generics
        here keeps this a real `Link` — with active-state and prefetch
        support — while avoiding an unchecked `to` string.
      */}
      <Link<typeof router, string, string>
        to="/search"
        className="flex max-w-[340px] items-center gap-2 border border-border-2 bg-surface px-[11px] py-[7px] font-mono text-[11px] text-dim"
      >
        <Search size={12} />
        <span className="flex-1 truncate text-left">search tag, person, place…</span>
        <span className="border border-border-2 px-1 py-0.5 font-mono text-[9px] text-faint">⌘F</span>
      </Link>
      <TypeChips />
      <MissingChip />
      <SortMenu />
      <DensityToggle />
      {count !== undefined && (
        <span className="inline-block min-w-[12ch] text-right font-mono text-[10px] text-faint tabular-nums">
          {count} items
        </span>
      )}
    </div>
  );
}
