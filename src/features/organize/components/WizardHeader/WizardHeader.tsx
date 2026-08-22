import type { WizardHeaderProps } from "./WizardHeader.types";

export function WizardHeader({ eyebrow, title, note }: WizardHeaderProps) {
  return (
    <header className="flex items-start gap-6 border-b border-border px-[34px] pt-[26px] pb-[22px]">
      <div className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] tracking-[3px] text-dim">{eyebrow}</span>
        <h2 className="text-[34px] font-semibold tracking-[-1px]">{title}</h2>
      </div>
      <div className="flex-1" />
      {note && (
        <p className="max-w-[340px] text-right text-[13px] text-muted-foreground">{note}</p>
      )}
    </header>
  );
}
