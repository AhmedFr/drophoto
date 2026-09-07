import { useEffect, useRef, type RefObject } from "react";

/** How close to an edge the pointer has to get before the grid starts moving. */
export const EDGE_ZONE = 60;

/** The fastest the grid scrolls, at the very edge of the container. */
export const MAX_SPEED = 15;

/**
 * The steady rate used when the user has asked for reduced motion. The
 * ramp below is the smoothing; without it the scroll needs one rate rather
 * than an accelerating one.
 */
export const REDUCED_SPEED = 8;

function prefersReducedMotion(): boolean {
  // `matchMedia` is absent in jsdom unless a test stubs it, and the honest
  // default for "we can't tell" is the unreduced one.
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/**
 * Scrolls a container while a drag-select is in progress and the pointer
 * sits near its top or bottom edge — so a selection can run past what is
 * currently on screen without the user letting go.
 *
 * Split out of `VirtualGrid` because it is a self-contained loop over
 * pointer position and `scrollTop`, testable without a virtualizer, a
 * layout, or a single tile.
 *
 * The loop runs on `requestAnimationFrame` (rather than off `pointermove`)
 * because the gesture has to keep scrolling while the pointer is held
 * still in the edge zone — which is exactly when no move events arrive.
 *
 * `prefers-reduced-motion` is respected by dropping the *smoothing*, not
 * the feature: the speed stops ramping with how deep into the zone the
 * pointer is, and becomes a single steady rate. Disabling it outright
 * would leave a reduced-motion user unable to select past one screenful.
 */
export function useEdgeAutoScroll(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  /**
   * Reports the tile now under the pointer, as its `data-tile-index`.
   *
   * Auto-scroll would otherwise scroll but not select: the range only
   * grows through each tile's `pointerenter`, and a pointer held still
   * past the bottom of the window — the case this feature exists for — is
   * over no tile at all and fires nothing. So every scrolling frame
   * re-resolves what is under the pointer and says so.
   */
  onTileUnderPointer?: (index: number) => void,
) {
  // Read by the animation loop, which must not be restarted every time the
  // pointer moves a pixel.
  const pointerX = useRef(0);
  const pointerY = useRef<number | null>(null);
  // The last index reported, so a frame that resolves the same tile as the
  // one before doesn't write the selection again on every frame.
  const reported = useRef<number | null>(null);
  // Kept in a ref so a new callback identity doesn't tear down and restart
  // the loop mid-gesture. Updated in an effect (not during render), and
  // declared before the loop below so it is already current by the time
  // the first frame runs.
  const report = useRef(onTileUnderPointer);
  useEffect(() => {
    report.current = onTileUnderPointer;
  }, [onTileUnderPointer]);

  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;

    const reduced = prefersReducedMotion();
    let frame = 0;

    // Listening on `document`, not the container: the pointer routinely
    // leaves the grid during a drag (that is what dragging past the edge
    // means), and the scroll has to keep following it.
    const onPointerMove = (e: PointerEvent) => {
      pointerX.current = e.clientX;
      pointerY.current = e.clientY;
    };

    /**
     * The tile under the pointer after this frame's scroll, with the
     * pointer's Y pulled back inside the container first — outside it
     * there is nothing to hit, and what the user means by holding the
     * pointer below the grid is "the tile at the bottom edge".
     */
    const reportTileUnderPointer = (y: number) => {
      // jsdom has no `elementFromPoint`, and neither does any environment
      // without layout; scrolling without reporting is still better than
      // throwing.
      if (typeof document.elementFromPoint !== "function") return;
      const { top, bottom } = el.getBoundingClientRect();
      const clamped = Math.min(Math.max(y, top + 1), bottom - 1);
      const hit = document.elementFromPoint(pointerX.current, clamped);
      const tile = hit?.closest?.("[data-tile-index]");
      const index = tile ? Number(tile.getAttribute("data-tile-index")) : null;
      if (index === null || Number.isNaN(index) || index === reported.current) return;
      reported.current = index;
      report.current?.(index);
    };

    const step = () => {
      frame = requestAnimationFrame(step);
      const y = pointerY.current;
      if (y === null) return;

      const { top, bottom } = el.getBoundingClientRect();
      // How far into the zone the pointer is, 0 at its inner boundary and
      // 1 at the container's edge. Negative when the pointer is outside
      // the zone, and clamped past the edge so leaving the window doesn't
      // accelerate without limit.
      const intoTop = (EDGE_ZONE - (y - top)) / EDGE_ZONE;
      const intoBottom = (EDGE_ZONE - (bottom - y)) / EDGE_ZONE;

      let direction = 0;
      let depth = 0;
      if (intoTop > 0 && intoTop >= intoBottom) {
        direction = -1;
        depth = Math.min(1, intoTop);
      } else if (intoBottom > 0) {
        direction = 1;
        depth = Math.min(1, intoBottom);
      }
      if (direction === 0) return;

      const speed = reduced ? REDUCED_SPEED : MAX_SPEED * depth;
      el.scrollTop += direction * speed;
      // After the scroll, not before: the tile now under the pointer is
      // the one the grid just moved into place there.
      reportTileUnderPointer(y);
    };

    document.addEventListener("pointermove", onPointerMove);
    frame = requestAnimationFrame(step);

    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      cancelAnimationFrame(frame);
      // The next gesture starts from wherever its own pointer is, not from
      // where this one ended.
      pointerY.current = null;
      reported.current = null;
    };
  }, [ref, active]);
}
