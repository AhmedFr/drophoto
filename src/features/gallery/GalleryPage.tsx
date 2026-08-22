import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { listMedia } from "@/lib/api/media";
import { ThumbGrid } from "./components/ThumbGrid";

export function GalleryPage() {
  const media = useQuery({ queryKey: ["media", 0], queryFn: () => listMedia(500, 0) });
  const items = media.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Gallery">
        <span className="font-mono text-[10px] text-faint">{items.length} items</span>
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        {media.isSuccess && items.length === 0 ? (
          <div className="p-5 font-mono text-[11px] text-faint">
            No media yet — register and scan a{" "}
            <a href="/drives" className="underline">
              drive
            </a>
            .
          </div>
        ) : (
          <ThumbGrid items={items} />
        )}
      </div>
    </div>
  );
}
