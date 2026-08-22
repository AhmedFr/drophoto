import type { PageHeaderProps } from "./PageHeader.types";
export function PageHeader({ title, children }: PageHeaderProps) {
  return (
    <header className="flex h-[52px] flex-none items-center gap-3.5 border-b border-border px-5">
      <h1 className="font-mono text-[10px] uppercase tracking-[1.5px]">{title.toUpperCase()}</h1>
      <div className="flex-1" />
      {children}
    </header>
  );
}
