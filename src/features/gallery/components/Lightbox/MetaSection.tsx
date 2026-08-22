import type { ReactNode } from "react";

export function MetaSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-[26px] first:mt-0">
      <div className="border-b border-border pb-1.5 font-mono text-[9px] tracking-[2.5px] text-faint">
        {title}
      </div>
      {children}
    </div>
  );
}
