import { HEADER_HEIGHT } from "@/lib/media/layout";

type MonthHeaderProps = {
  label: string;
  count: number;
  /** This month's media ids, in group order — passed through to `onSelect`. */
  ids: number[];
  /**
   * Whether every photo in this section is already selected. The action is
   * a checkbox for the section, so in that state it deselects rather than
   * re-selecting, and says so. Defaults to false.
   */
  allSelected?: boolean;
  /** `additive` is true on cmd/ctrl-click (add to the selection) vs. a plain click (replace it). */
  onSelect: (ids: number[], additive: boolean) => void;
};

export function MonthHeader({
  label,
  count,
  ids,
  allSelected = false,
  onSelect,
}: MonthHeaderProps) {
  return (
    <div className="flex items-baseline gap-2 px-1" style={{ height: HEADER_HEIGHT }}>
      <h2 className="text-[19px] font-semibold">{label}</h2>
      <span className="font-mono text-[10px] text-faint">{count}</span>
      {/*
        One control with two meanings, named for the one it currently has:
        "SELECT ALL" while anything in the section is still unselected,
        "DESELECT ALL" once the whole section is in. A button that said
        "SELECT ALL" and removed the section would be lying about what
        pressing it does.
      */}
      <button
        type="button"
        aria-label={`${allSelected ? "Deselect" : "Select"} all ${count} in ${label}`}
        className="font-mono text-[9px] tracking-[1px] text-faint underline decoration-dotted underline-offset-2 hover:text-foreground"
        onClick={(e) => onSelect(ids, e.metaKey || e.ctrlKey)}
      >
        {allSelected ? "DESELECT ALL" : "SELECT ALL"}
      </button>
    </div>
  );
}
