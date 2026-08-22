import { cn } from "@/lib/utils";
import type { SidebarProps } from "./Sidebar.types";
export function Sidebar({ items, activeId, onNavigate }: SidebarProps) {
  return (
    <nav className="flex h-full w-[212px] flex-none flex-col border-r border-border bg-background">
      <div className="flex h-[52px] items-center px-5 font-mono text-[10px] tracking-[2.5px]">
        DROPHOTO
      </div>
      <ul className="flex flex-col gap-0.5 px-2 pt-2">
        {items.map((m) => {
          const active = m.id === activeId;
          const Icon = m.icon;
          return (
            <li key={m.id}>
              <a
                href={m.path}
                aria-current={active ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate(m.path);
                }}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors",
                  active
                    ? "bg-surface text-foreground"
                    : "text-muted-foreground hover:bg-surface hover:text-foreground",
                )}
              >
                <Icon size={14} strokeWidth={1.6} />
                {m.title}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
