export function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 font-mono text-[11px]">
      <span className="text-dim">{label}</span>
      <span className="text-right text-foreground">{value}</span>
    </div>
  );
}
