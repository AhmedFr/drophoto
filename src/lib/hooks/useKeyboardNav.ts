import { useEffect } from "react";

export type UseKeyboardNavOptions = {
  enabled: boolean;
  onClose?(): void;
  onPrev(): void;
  onNext(): void;
};

/**
 * Whether `target` is something the user types into — a text field, a
 * textarea, or any `contenteditable` element. The listener below is bound
 * on `window`, so it sees every keystroke in the app, including the ones
 * meant for a text box: `ArrowLeft` in the tag panel's filter moves the
 * caret, and must never also flip the lightbox to another photo.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}

/**
 * Binds `Escape` / `ArrowLeft` / `ArrowRight` on `window` to `onClose` /
 * `onPrev` / `onNext` respectively, while `enabled` is `true`. Keystrokes
 * aimed at a text field (see `isTypingTarget`) are left entirely alone.
 * The listener is torn down on unmount and whenever `enabled` (or a
 * callback identity) changes. `onClose` is optional — omit it when Escape
 * is already handled elsewhere (e.g. by Radix's `Dialog`) to avoid
 * double-handling.
 */
export function useKeyboardNav({ enabled, onClose, onPrev, onNext }: UseKeyboardNavOptions): void {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === "Escape") onClose?.();
      else if (e.key === "ArrowLeft") onPrev();
      else if (e.key === "ArrowRight") onNext();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onClose, onPrev, onNext]);
}
