import { HEADER_HEIGHT } from "@/lib/media/layout";

type MonthHeaderProps = { label: string; count: number };

export function MonthHeader({ label, count }: MonthHeaderProps) {
  return (
    <div className="flex items-baseline gap-2 px-1" style={{ height: HEADER_HEIGHT }}>
      <h2 className="text-[19px] font-semibold">{label}</h2>
      <span className="font-mono text-[10px] text-faint">{count}</span>
    </div>
  );
}
