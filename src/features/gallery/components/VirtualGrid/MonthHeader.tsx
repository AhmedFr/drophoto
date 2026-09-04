import { HEADER_HEIGHT } from "@/lib/media/layout";

type MonthHeaderProps = {
  label: string;
  count: number;
  /** This month's media ids, in group order — passed through to `onSelect`. */
  ids: number[];
  /** `additive` is true on cmd/ctrl-click (add to the selection) vs. a plain click (replace it). */
  onSelect: (ids: number[], additive: boolean) => void;
};

export function MonthHeader({ label, count, ids, onSelect }: MonthHeaderProps) {
  return (
    <div className="flex items-baseline gap-2 px-1" style={{ height: HEADER_HEIGHT }}>
      <h2 className="text-[19px] font-semibold">{label}</h2>
      <span className="font-mono text-[10px] text-faint">{count}</span>
      <button
        type="button"
        aria-label={`Select all ${count} in ${label}`}
        className="font-mono text-[9px] tracking-[1px] text-faint underline decoration-dotted underline-offset-2 hover:text-foreground"
        onClick={(e) => onSelect(ids, e.metaKey || e.ctrlKey)}
      >
        SELECT ALL
      </button>
    </div>
  );
}
