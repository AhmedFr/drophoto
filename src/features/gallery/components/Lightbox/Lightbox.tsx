import type { MouseEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useKeyboardNav } from "@/lib/hooks/useKeyboardNav";
import { basename } from "@/lib/media/format";
import { LightboxImage } from "./LightboxImage";
import { MetaPanel } from "./MetaPanel";
import type { LightboxProps } from "./Lightbox.types";

const navButtonClass =
  "flex size-[38px] shrink-0 items-center justify-center border border-border text-dim outline-none hover:text-foreground focus-visible:border-ring";

export function Lightbox({ items, index, onClose, onPrev, onNext }: LightboxProps) {
  const item = items[index];

  useKeyboardNav({ enabled: true, onClose, onPrev, onNext });

  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={basename(item.row.rel_path)}
      className="fixed inset-0 z-50 flex bg-[rgba(6,6,6,0.97)]"
      onClick={onClose}
    >
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between p-6">
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[10.5px] tracking-[1.5px] text-dim hover:text-foreground"
          >
            CLOSE
          </button>
          <span className="font-mono text-[10.5px] tracking-[1.5px] text-dim">
            {String(index + 1).padStart(2, "0")} / {items.length}
          </span>
        </div>

        <div className="flex flex-1 items-center justify-center gap-4 overflow-hidden px-6 pb-6">
          <button
            type="button"
            aria-label="Previous"
            className={navButtonClass}
            onClick={(e) => {
              stop(e);
              onPrev();
            }}
          >
            <ChevronLeft size={16} />
          </button>

          <LightboxImage key={item.row.id} item={item} />

          <button
            type="button"
            aria-label="Next"
            className={navButtonClass}
            onClick={(e) => {
              stop(e);
              onNext();
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <aside
        className="w-[372px] shrink-0 overflow-y-auto border-l border-border bg-[#0b0b0a] p-6"
        onClick={stop}
      >
        <MetaPanel item={item} />
      </aside>
    </div>
  );
}
