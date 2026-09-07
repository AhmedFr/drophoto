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
export function useEdgeAutoScroll(ref: RefObject<HTMLElement | null>, active: boolean) {
  // Read by the animation loop, which must not be restarted every time the
  // pointer moves a pixel.
  const pointerY = useRef<number | null>(null);

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
      pointerY.current = e.clientY;
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
    };

    document.addEventListener("pointermove", onPointerMove);
    frame = requestAnimationFrame(step);

    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      cancelAnimationFrame(frame);
      // The next gesture starts from wherever its own pointer is, not from
      // where this one ended.
      pointerY.current = null;
    };
  }, [ref, active]);
}
