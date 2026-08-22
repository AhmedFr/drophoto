import { Link } from "@tanstack/react-router";
import type { router } from "@/app/router";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { ThumbGrid } from "./components/ThumbGrid";
import { useMediaCount } from "./hooks/useMediaCount";
import { useMediaInfinite } from "./hooks/useMediaInfinite";

export function GalleryPage() {
  const media = useMediaInfinite();
  const count = useMediaCount();
  const items = media.items;
  const headerCount = count ?? items.length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Gallery">
        <span className="font-mono text-[10px] text-faint">{headerCount} items</span>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
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
          <>
            <ThumbGrid items={items} />
            {media.hasNextPage && (
              // Temporary "Load more" control until Task 2.4 wires up
              // scroll-triggered pagination.
              <div className="flex justify-center p-5">
                <Button
                  variant="outline"
                  className="font-mono text-[10px]"
                  onClick={() => media.fetchNextPage()}
                  disabled={media.isFetchingNextPage}
                >
                  {media.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
