import type { PlaceCount } from "@/lib/api/places";

export type PlaceListProps = {
  placeCounts: PlaceCount[];
  onSelectPlace: (placeId: number) => void;
};
