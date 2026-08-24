import type { MouseEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useKeyboardNav } from "@/lib/hooks/useKeyboardNav";
import { basename } from "@/lib/media/format";
import { LightboxImage } from "./LightboxImage";
import { MetaPanel } from "./MetaPanel";
import type { LightboxProps } from "./Lightbox.types";

const navButtonClass =
  "flex size-[38px] shrink-0 items-center justify-center border border-border text-dim outline-none hover:text-foreground focus-visible:border-ring";

export function Lightbox({ items, index, onClose, onPrev, onNext, onTagPanelOpenChange }: LightboxProps) {
  const item = items[index];

  // Escape is already handled by Radix's `Dialog.Content` (via its
  // focus-trapping `DismissableLayer`, which calls `onOpenChange(false)` ->
  // `onClose`), so `onClose` is intentionally omitted here — wiring it to
  // both would double-handle the same keystroke. Outside-click is likewise
  // Radix's job. This hook only covers arrow-key navigation, which Radix
  // doesn't know about.
  useKeyboardNav({ enabled: true, onPrev, onNext });

  // `items` can shrink out from under an open lightbox (e.g. a refetch after
  // a scan removes media); `GalleryPage` clamps `index` back in bounds on
  // the next render, but this guards the render in between. Placed after
  // the hook call above so hooks still run unconditionally on every render.
  if (!item) return null;

  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-testid="lightbox-overlay"
          className="fixed inset-0 z-50 bg-[rgba(6,6,6,0.97)]"
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex outline-none"
          onClick={onClose}
        >
          <DialogPrimitive.Title className="sr-only">{basename(item.row.rel_path)}</DialogPrimitive.Title>

          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between p-6">
              <button
                type="button"
                onClick={(e) => {
                  stop(e);
                  onClose();
                }}
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
            <MetaPanel
              key={item.row.id}
              item={item}
              onTagPanelOpenChange={onTagPanelOpenChange}
            />
          </aside>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
