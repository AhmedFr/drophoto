import { useCallback, useEffect, useRef, useState } from "react";
import { EDGE_PADDING_PX, KEY_STEP_RATIO, WHEEL_LINE_HEIGHT_PX } from "./DateScrubber.constants";

/**
 * The scrub gesture: turning a pointer position on the track into a scroll
 * offset, and keeping the handle in step with the container the rest of
 * the time.
 *
 * Split out of `DateScrubber` because it is pure interaction — pointer
 * geometry and `scrollTop` — with no bearing on how the track looks, and
 * because it is the half that has to keep working when the container is
 * scrolled by something else entirely (wheel, trackpad, keyboard, Page
 * Up/Down). The scrubber only ever *writes* `scrollTop` on a gesture of
 * its own; every other scroll is simply followed.
 *
 * `contentVersion` is not read, only depended upon: when it changes the
 * scrolled content may have grown or shrunk, so the range is measured
 * again. Without it a grid that becomes scrollable after its first paint
 * would keep reporting itself as having nothing to scroll.
 */
export function useScrubber(
  scrollElement: HTMLElement | null,
  disabled: boolean,
  contentVersion?: unknown,
) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);

  /** How far down the scrollable range the container currently sits, 0–1. */
  const [ratio, setRatio] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  /**
   * The last measured scrollable range. Kept in state (unlike the live
   * reads below, which the arithmetic uses so a write is never based on a
   * stale number) because whether there is anything to scroll at all
   * decides whether this is a control the keyboard can reach — see
   * `scrollable`.
   */
  const [measuredRange, setMeasuredRange] = useState(0);

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
      setMeasuredRange(range);
      setRatio(range > 0 ? Math.min(1, Math.max(0, scrollElement.scrollTop / range)) : 0);
    };
    update();
    scrollElement.addEventListener("scroll", update, { passive: true });
    return () => scrollElement.removeEventListener("scroll", update);
  }, [scrollElement, contentVersion]);

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
   * The pointer's position along the track, as a fraction of the run the
   * handle itself travels — the same `EDGE_PADDING_PX` inset the handle and
   * the year labels are drawn with, so grabbing the handle doesn't make it
   * jump and a label sits exactly where the pointer has to go to reach it.
   * Past either end the ratio simply clamps, so the extremes stay reachable.
   */
  const ratioForClientY = useCallback((clientY: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const { top, height } = track.getBoundingClientRect();
    const usable = height - EDGE_PADDING_PX * 2;
    if (usable <= 0) return 0;
    return (clientY - top - EDGE_PADDING_PX) / usable;
  }, []);

  // Kept in a ref so the move/up listeners registered below always see the
  // current one without being torn down and re-added mid-gesture.
  const scrollToRatioRef = useRef(scrollToRatio);
  useEffect(() => {
    scrollToRatioRef.current = scrollToRatio;
  }, [scrollToRatio]);

  // Tears down the live gesture's `document` listeners. Held in a ref so
  // that unmounting mid-scrub can run it too: `DateScrubber` goes away the
  // moment the timeline does (a search that matches nothing), and the
  // listeners would otherwise keep writing to a detached container until
  // the user happened to let go.
  const endScrub = useRef<(() => void) | null>(null);
  useEffect(() => () => endScrub.current?.(), []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // A drag-select owns the same container while it runs, auto-scrolling
      // it from its own animation loop — two writers on one `scrollTop`
      // would fight, so the scrubber declines rather than interleaving.
      if (disabled || scrollRange() <= 0) return;

      // Deliberately no `preventDefault()`: suppressing the default would
      // suppress the focus it carries, leaving a slider that can only ever
      // be reached by Tab and never by clicking it. Focus is moved to the
      // handle explicitly instead, so the keyboard picks up where the
      // pointer left off. (Text selection is already ruled out by the
      // track's `select-none`.)
      handleRef.current?.focus?.();
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
        endScrub.current = null;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onEnd);
        document.removeEventListener("pointercancel", onEnd);
      };
      endScrub.current = onEnd;
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onEnd);
      document.addEventListener("pointercancel", onEnd);
    },
    [disabled, ratioForClientY, scrollRange, scrollToRatio],
  );

  /**
   * Forwards a wheel over the track to the grid underneath.
   *
   * The track is a sibling of the scroll container, overlaying its edge, so
   * a wheel event that lands on it has no scrollable ancestor to bubble to
   * (the wrapper doesn't scroll and the body is `overflow: hidden`) and the
   * grid would simply sit still. That dead zone is 56px wide exactly when
   * the pointer is over the strip — and a native scrollbar has never
   * behaved that way.
   */
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const el = scrollElement;
      if (!el) return;
      const range = scrollRange();
      if (range <= 0) return;
      // `deltaY` is in lines or pages rather than pixels on some mice and
      // in some browsers.
      const unit =
        e.deltaMode === 1 ? WHEEL_LINE_HEIGHT_PX : e.deltaMode === 2 ? el.clientHeight : 1;
      // Through `scrollToRatio` rather than by assigning `scrollTop`: one
      // write path, one clamp, and the handle moves with it.
      scrollToRatio((el.scrollTop + e.deltaY * unit) / range);
    },
    [scrollElement, scrollRange, scrollToRatio],
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

  return {
    trackRef,
    handleRef,
    ratio,
    scrubbing,
    /**
     * Whether there is anything to scroll. False makes the handle a
     * decoration rather than a control — no `role`, no tab stop — because
     * a slider the keyboard can reach that answers no key and reports a
     * value it can never change is worse than no slider at all.
     */
    scrollable: measuredRange > 0,
    onPointerDown,
    onWheel,
    onKeyDown,
  };
}
