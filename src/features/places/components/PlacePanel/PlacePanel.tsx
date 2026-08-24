import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { searchCities, setMediaPlace } from "@/lib/api/places";
import type { City } from "@/lib/api/places";
import type { PlacePanelProps } from "./PlacePanel.types";

/** How long to wait after the last keystroke before firing `searchCities`. */
const DEBOUNCE_MS = 200;

/**
 * Manual place override picker for a set of media ids — from
 * `SelectionBar`'s PLACE button, and from `MetaPanel`'s single-id PLACE
 * row. Styled like `TagPanel` (a plain Radix Dialog), but there's no
 * staging step here: picking a city or clearing applies immediately,
 * since a media set has at most one place (unlike tags, which are
 * many-to-many and benefit from batching add/remove before a single
 * APPLY).
 */
export function PlacePanel({ mediaIds, open, onClose }: PlacePanelProps) {
  const queryClient = useQueryClient();

  const [filterText, setFilterText] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");

  // Reset staged input whenever the dialog transitions from closed to open
  // — same "adjust state during render when a prop changes" pattern as
  // `TagPanel`'s `resetForOpen`.
  const [resetForOpen, setResetForOpen] = useState(open);
  if (open !== resetForOpen) {
    setResetForOpen(open);
    if (open) {
      setFilterText("");
      setDebouncedFilter("");
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFilter(filterText), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filterText]);

  const trimmed = debouncedFilter.trim();
  const citiesQuery = useQuery({
    queryKey: ["cities", trimmed],
    queryFn: () => searchCities(trimmed),
    enabled: trimmed !== "",
  });
  const cities = citiesQuery.data ?? [];

  const mutation = useMutation({
    mutationFn: (city: City | null) => setMediaPlace(mediaIds, city),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["places"] });
      queryClient.invalidateQueries({ queryKey: ["media"] });
      queryClient.invalidateQueries({ queryKey: ["search"] });
      onClose();
    },
  });

  const error = mutation.isError ? (mutation.error as Error).message : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Place</DialogTitle>
        </DialogHeader>

        <Input
          placeholder="Search a city…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          autoFocus
        />

        <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          {trimmed === "" && (
            <p className="py-1.5 font-mono text-[11px] text-dim">Type to search for a city.</p>
          )}
          {trimmed !== "" && !citiesQuery.isFetching && cities.length === 0 && (
            <p className="py-1.5 font-mono text-[11px] text-dim">No cities found.</p>
          )}
          {cities.map((city) => (
            <button
              key={`${city.name}-${city.admin}-${city.country}`}
              type="button"
              onClick={() => mutation.mutate(city)}
              disabled={mutation.isPending}
              className="py-1.5 text-left font-mono text-[11px] text-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              {city.name}
              {city.admin ? `, ${city.admin}` : ""}, {city.country}
            </button>
          ))}
        </div>

        {error && <p className="font-mono text-[11px] text-red-400">{error}</p>}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={mutation.isPending}>
            CANCEL
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => mutation.mutate(null)}
            disabled={mutation.isPending}
          >
            CLEAR PLACE
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
