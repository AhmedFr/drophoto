import { useCallback, useEffect, useRef, useState } from "react";
import { KEY_STEP_RATIO } from "./DateScrubber.constants";

/**
 * The scrub gesture: turning a pointer position on the track into a scroll
 * offset, and keeping the handle in step with the container the rest of
 * the time.
 *
 * Split out of `DateScrubber` because it is pure interaction — pointer
 * geometry and `scrollTop` — with no bearing on how the track looks, and
 * because it is the half that has to keep working when the container is
 * scrolled by something else entirely (wheel, trackpad, keyboard, Page
 * Up/Down). The scrubber only ever *writes* `scrollTop` while a pointer is
 * down; every other scroll is simply followed.
 */
export function useScrubber(scrollElement: HTMLElement | null, disabled: boolean) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  /** How far down the scrollable range the container currently sits, 0–1. */
  const [ratio, setRatio] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);

  const scrollRange = useCallback(() => {
    if (!scrollElement) return 0;
    return Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
  }, [scrollElement]);

  // Follow the container however it was scrolled. This is what keeps the
  // scrubber a supplement rather than a replacement: the wheel, the
  // trackpad, the arrow keys and Page Up/Down all still drive the grid,
  // and the handle simply reports where they left it.
  useEffect(() => {
    if (!scrollElement) return;
    const update = () => {
      const range = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
      setRatio(range > 0 ? Math.min(1, Math.max(0, scrollElement.scrollTop / range)) : 0);
    };
    update();
    scrollElement.addEventListener("scroll", update, { passive: true });
    return () => scrollElement.removeEventListener("scroll", update);
  }, [scrollElement]);

  /** Scrolls the container to `next` (0–1) and moves the handle with it. */
  const scrollToRatio = useCallback(
    (next: number) => {
      const clamped = Math.min(1, Math.max(0, next));
      // Set optimistically rather than waiting for the container's own
      // `scroll` event, so the handle and the date pill track the pointer
      // on the same frame the user moved it.
      setRatio(clamped);
      scrollElement?.scrollTo({ top: clamped * scrollRange(), behavior: "auto" });
    },
    [scrollElement, scrollRange],
  );

  /**
   * The pointer's position along the track, as a fraction of its height.
   * Deliberately unpadded: the top of the track means the top of the
   * library, and the bottom means the bottom, with nothing unreachable at
   * either end.
   */
  const ratioForClientY = useCallback((clientY: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const { top, height } = track.getBoundingClientRect();
    if (height <= 0) return 0;
    return (clientY - top) / height;
  }, []);

  // Kept in a ref so the move/up listeners registered below always see the
  // current one without being torn down and re-added mid-gesture.
  const scrollToRatioRef = useRef(scrollToRatio);
  useEffect(() => {
    scrollToRatioRef.current = scrollToRatio;
  }, [scrollToRatio]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // A drag-select owns the same container while it runs, auto-scrolling
      // it from its own animation loop — two writers on one `scrollTop`
      // would fight, so the scrubber declines rather than interleaving.
      if (disabled || scrollRange() <= 0) return;
      e.preventDefault();
      setScrubbing(true);
      scrollToRatio(ratioForClientY(e.clientY));

      // Capture keeps the gesture attached to the track when the pointer
      // leaves it (which it will, the moment the user's hand drifts left
      // over the photos). jsdom implements neither capture method, and a
      // browser rejects a pointer that has already been released — a
      // failure to capture must not abort a scrub that is otherwise fine,
      // hence the guard.
      const target = e.currentTarget as Element;
      try {
        target.setPointerCapture?.(e.pointerId);
      } catch {
        /* no capture available — the document listeners below still carry the drag */
      }

      // Listening on `document`, not the track: with or without capture
      // these fire, and `pointercancel` (a system gesture taking over)
      // ends the scrub as cleanly as a release does.
      const onMove = (event: PointerEvent) =>
        scrollToRatioRef.current(ratioForClientY(event.clientY));
      const onEnd = () => {
        setScrubbing(false);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onEnd);
        document.removeEventListener("pointercancel", onEnd);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onEnd);
      document.addEventListener("pointercancel", onEnd);
    },
    [disabled, ratioForClientY, scrollRange, scrollToRatio],
  );

  /**
   * The handle's own keyboard operation. A focusable `role="slider"` that
   * answered nothing would be a control the keyboard can reach and not
   * use; the keys it does claim are stopped there so the gallery's own
   * grid-level handler doesn't act on the same press as well.
   */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const range = scrollRange();
      if (range <= 0) return;
      const page = scrollElement ? scrollElement.clientHeight / range : 0;
      const step = page * KEY_STEP_RATIO;

      const delta =
        e.key === "ArrowDown"
          ? step
          : e.key === "ArrowUp"
            ? -step
            : e.key === "PageDown"
              ? page
              : e.key === "PageUp"
                ? -page
                : null;

      if (delta !== null) {
        e.preventDefault();
        e.stopPropagation();
        scrollToRatio(ratio + delta);
        return;
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        e.stopPropagation();
        scrollToRatio(e.key === "Home" ? 0 : 1);
      }
    },
    [ratio, scrollElement, scrollRange, scrollToRatio],
  );

  return { trackRef, ratio, scrubbing, onPointerDown, onKeyDown };
}
