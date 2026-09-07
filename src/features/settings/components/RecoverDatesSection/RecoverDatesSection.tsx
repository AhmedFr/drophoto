import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { countUndated, recoverFilenameDates } from "@/lib/api/media";

/**
 * Settings' "Photos without a date" panel: how many `media` rows have no
 * `taken_at` at all, with a RECOVER FROM FILENAMES action that fills them
 * in from names like `IMG-20240816-WA0010.jpg` (see
 * `dp_metadata::date_from_filename`) — it only ever fills a row that is
 * still undated, so a real EXIF date already on a row is never touched.
 * A successful run invalidates this panel's own count plus the gallery's
 * media queries, so a newly-dated photo moves off "Undated" immediately.
 */
export function RecoverDatesSection() {
  const queryClient = useQueryClient();

  const countQuery = useQuery({
    queryKey: ["count-undated"],
    queryFn: countUndated,
  });
  const count = countQuery.data ?? 0;

  const recoverMutation = useMutation({
    mutationFn: recoverFilenameDates,
    onSuccess: (recovered) => {
      queryClient.invalidateQueries({ queryKey: ["count-undated"] });
      queryClient.invalidateQueries({ queryKey: ["media"] });
      queryClient.invalidateQueries({ queryKey: ["media-count"] });
      if (recovered > 0) {
        toast.success(`Recovered dates for ${recovered} photos`);
      } else {
        toast.info("No dates could be recovered");
      }
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Failed to recover dates.");
    },
  });

  return (
    <div className="flex flex-col">
      <div className="flex items-center px-6 pt-5 pb-2">
        <span className="font-mono text-[9px] tracking-[2px] text-faint">PHOTOS WITHOUT A DATE</span>
      </div>

      <div className="flex items-center gap-3 px-6 pb-6">
        <span className="font-mono text-[11px] text-muted-foreground">
          {countQuery.isLoading ? "—" : count}
        </span>
        <span className="flex-1" />
        <Button
          variant="outline"
          size="xs"
          onClick={() => recoverMutation.mutate()}
          disabled={count === 0 || recoverMutation.isPending}
        >
          {recoverMutation.isPending ? "Recovering…" : "Recover from filenames"}
        </Button>
      </div>
    </div>
  );
}
