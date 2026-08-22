import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { router } from "@/app/router";
import { PageHeader } from "@/components/PageHeader";
import { queryMedia } from "@/lib/api/media";
import { ThumbGrid } from "./components/ThumbGrid";

export function GalleryPage() {
  const media = useQuery({
    queryKey: ["media", 0],
    queryFn: () => queryMedia({ kinds: [], exts: [], sort: "taken_desc", limit: 500, offset: 0 }),
  });
  const items = media.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Gallery">
        <span className="font-mono text-[10px] text-faint">{items.length} items</span>
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
          <ThumbGrid items={items} />
        )}
      </div>
    </div>
  );
}
