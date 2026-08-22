import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format/bytes";
import { WIZARD_STEPS } from "./StepRail.constants";
import type { StepRailProps } from "./StepRail.types";

export function StepRail({ step, selectedCount, selectedBytes }: StepRailProps) {
  return (
    <aside className="flex w-[262px] flex-none flex-col border-r border-border px-[22px] py-6">
      <h1 className="text-[15px] font-semibold">Organize</h1>
      <div className="mt-5 font-mono text-[9px] tracking-[2.5px] text-faint">ORGANIZE</div>

      <ul className="mt-2 flex flex-col gap-0.5">
        {WIZARD_STEPS.map((s, i) => {
          const status = i < step ? "done" : i === step ? "active" : "pending";
          return (
            <li
              key={s.number}
              className={cn(
                "flex items-center gap-3 px-3 py-[11px]",
                status === "active" && "bg-surface",
              )}
            >
              <span
                className={cn(
                  "flex size-[26px] flex-none items-center justify-center border font-mono text-[11px]",
                  status === "active" && "border-primary bg-primary text-primary-foreground",
                  status === "done" && "border-border-3 text-foreground",
                  status === "pending" && "border-border-3 text-faint",
                )}
              >
                {status === "done" ? "✓" : <span className="text-[9px] tracking-[1.5px]">{s.number}</span>}
              </span>
              <div className="flex flex-col">
                <span className="text-[13.5px] font-medium">{s.title}</span>
                <span className="text-[11px] text-dim">{s.sub}</span>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex-1" />

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between font-mono text-[11px]">
          <span className="text-dim">Selected</span>
          <span>{selectedCount}</span>
        </div>
        <div className="flex items-center justify-between font-mono text-[11px]">
          <span className="text-dim">Size</span>
          <span>{formatBytes(selectedBytes)}</span>
        </div>
        <div className="mt-3 font-mono text-[10px] text-faint">
          RUNS LOCALLY · NOTHING LEAVES THIS COMPUTER
        </div>
      </div>
    </aside>
  );
}
