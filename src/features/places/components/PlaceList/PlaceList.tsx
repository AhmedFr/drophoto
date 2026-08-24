import type { PlaceCount } from "@/lib/api/places";
import type { PlaceListProps } from "./PlaceList.types";

/** Groups `placeCounts` by country, each group's places sorted by name, and the groups themselves sorted by country — the offline fallback's whole point is a stable, browsable order without a map. */
function groupByCountry(placeCounts: PlaceCount[]): [string, PlaceCount[]][] {
  const byCountry = new Map<string, PlaceCount[]>();
  for (const pc of placeCounts) {
    const list = byCountry.get(pc.place.country) ?? [];
    list.push(pc);
    byCountry.set(pc.place.country, list);
  }
  for (const list of byCountry.values()) {
    list.sort((a, b) => a.place.name.localeCompare(b.place.name));
  }
  return [...byCountry.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Offline (or map-failed) fallback for `PlacesPage`: every place with media,
 * grouped by country, each row clickable the same way a map marker is.
 */
export function PlaceList({ placeCounts, onSelectPlace }: PlaceListProps) {
  const groups = groupByCountry(placeCounts);

  return (
    <div className="h-full overflow-y-auto p-5" data-testid="place-list">
      {groups.map(([country, places]) => (
        <div key={country} className="mb-6">
          <h3 className="mb-2 font-mono text-[10px] tracking-[1.5px] text-faint">{country.toUpperCase()}</h3>
          <div className="flex flex-col gap-0.5">
            {places.map(({ place, count }) => (
              <button
                key={place.id}
                type="button"
                onClick={() => onSelectPlace(place.id)}
                className="flex items-center justify-between py-1.5 text-left font-mono text-[11px] text-foreground hover:text-foreground"
              >
                <span>
                  {place.name}
                  {place.admin ? `, ${place.admin}` : ""}
                </span>
                <span className="text-dim">{count}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
