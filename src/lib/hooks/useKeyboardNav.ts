import { useEffect } from "react";

export type UseKeyboardNavOptions = {
  enabled: boolean;
  onClose(): void;
  onPrev(): void;
  onNext(): void;
};

/**
 * Binds `Escape` / `ArrowLeft` / `ArrowRight` on `window` to `onClose` /
 * `onPrev` / `onNext` respectively, while `enabled` is `true`. The listener
 * is torn down on unmount and whenever `enabled` (or a callback identity)
 * changes.
 */
export function useKeyboardNav({ enabled, onClose, onPrev, onNext }: UseKeyboardNavOptions): void {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") onPrev();
      else if (e.key === "ArrowRight") onNext();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onClose, onPrev, onNext]);
}
