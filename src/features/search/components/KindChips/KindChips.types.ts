export type SearchKindFilter = "ALL" | "PHOTOS" | "VIDEOS";

export type KindChipsProps = {
  value: SearchKindFilter;
  onChange: (value: SearchKindFilter) => void;
};
