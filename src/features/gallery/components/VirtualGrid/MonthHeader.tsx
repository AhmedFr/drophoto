type MonthHeaderProps = { label: string; count: number };

export function MonthHeader({ label, count }: MonthHeaderProps) {
  return (
    <div className="flex h-full items-baseline gap-2 px-1">
      <h2 className="text-[19px] font-semibold">{label}</h2>
      <span className="font-mono text-[10px] text-faint">{count}</span>
    </div>
  );
}
