import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { router } from "@/app/router";
import { PageHeader } from "@/components/PageHeader";
import { GalleryToolbar } from "./components/GalleryToolbar";
import { VirtualGrid } from "./components/VirtualGrid";
import { useMediaCount } from "./hooks/useMediaCount";
import { useMediaInfinite } from "./hooks/useMediaInfinite";
import { DENSITY_ROW_HEIGHT, useGalleryStore } from "./store/galleryStore";

export function GalleryPage() {
  const media = useMediaInfinite();
  const count = useMediaCount();
  const density = useGalleryStore((s) => s.density);
  const items = media.items;

  // Opened by `VirtualGrid`'s `onOpen`; the lightbox that reads it is added
  // in Task 2.6.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  void openIndex;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Gallery">
        <GalleryToolbar count={count} />
      </PageHeader>
      <div className="flex-1 overflow-hidden">
        {media.isError && (
          <p className="px-5 pt-5 font-mono text-[11px] text-red-400">{(media.error as Error).message}</p>
        )}
        {media.isSuccess && items.length === 0 ? (
          <div className="p-5 font-mono text-[11px] text-faint">
            No media yet — register and scan a{" "}
            {/*
              The feature registry (`src/app/registry.ts`) types each
              module's route `path` as a plain `string`, so the router's
              generated route tree loses literal path types and can't
              type-check `to` against the app's real routes (the same
              reason `Sidebar` navigates with a plain `<a>` + `onNavigate`
              instead of `Link`). Widening the generics here keeps this a
              real `Link` — with active-state and prefetch support — while
              avoiding an unchecked `to` string.
            */}
            <Link<typeof router, string, string> to="/drives" className="underline">
              drive
            </Link>
            .
          </div>
        ) : (
          <VirtualGrid
            items={items}
            targetRowHeight={DENSITY_ROW_HEIGHT[density]}
            onOpen={setOpenIndex}
            onNearEnd={() => {
              if (media.hasNextPage && !media.isFetchingNextPage) media.fetchNextPage();
            }}
          />
        )}
      </div>
    </div>
  );
}
