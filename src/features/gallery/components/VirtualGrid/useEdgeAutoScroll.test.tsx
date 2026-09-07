import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { EDGE_ZONE, MAX_SPEED, REDUCED_SPEED, useEdgeAutoScroll } from "./useEdgeAutoScroll";

/** The animation loop's most recent callback, so a test can drive frames. */
let nextFrame: FrameRequestCallback | null = null;

function tick(times = 1) {
  for (let i = 0; i < times; i++) {
    const frame = nextFrame;
    nextFrame = null;
    act(() => frame?.(0));
  }
}

function movePointerTo(clientY: number) {
  act(() => {
    document.dispatchEvent(new PointerEvent("pointermove", { clientY }));
  });
}

/**
 * A scroll container at y = 0..500. jsdom has no layout, so both the box
 * and `scrollTop` are stubbed — everything this hook does is arithmetic
 * over those two.
 */
function scroller() {
  const el = document.createElement("div");
  let scrollTop = 0;
  Object.defineProperty(el, "scrollTop", {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  el.getBoundingClientRect = () => ({ top: 0, bottom: 500, height: 500 }) as DOMRect;
  return el;
}

function setReducedMotion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({ matches: reduced && query.includes("reduce") }) as MediaQueryList,
  );
}

beforeEach(() => {
  nextFrame = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    nextFrame = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    nextFrame = null;
  });
  setReducedMotion(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("scrolls down while the pointer sits inside the bottom edge zone", () => {
  const el = scroller();
  renderHook(() => useEdgeAutoScroll({ current: el }, true));

  movePointerTo(500 - EDGE_ZONE / 2);
  tick();

  expect(el.scrollTop).toBeGreaterThan(0);
});

it("scrolls up while the pointer sits inside the top edge zone", () => {
  const el = scroller();
  el.scrollTop = 300;
  renderHook(() => useEdgeAutoScroll({ current: el }, true));

  movePointerTo(EDGE_ZONE / 2);
  tick();

  expect(el.scrollTop).toBeLessThan(300);
});

// Holding still in the zone has to keep scrolling — no further pointer
// events arrive, which is exactly why the loop is on rAF.
it("keeps scrolling frame after frame while the pointer is held still", () => {
  const el = scroller();
  renderHook(() => useEdgeAutoScroll({ current: el }, true));

  movePointerTo(495);
  tick();
  const afterOne = el.scrollTop;
  tick();

  expect(el.scrollTop).toBeGreaterThan(afterOne);
});

it("does not scroll while the pointer is away from both edges", () => {
  const el = scroller();
  renderHook(() => useEdgeAutoScroll({ current: el }, true));

  movePointerTo(250);
  tick(3);

  expect(el.scrollTop).toBe(0);
});

it("does not scroll before the pointer has been seen at all", () => {
  const el = scroller();
  renderHook(() => useEdgeAutoScroll({ current: el }, true));

  tick(3);

  expect(el.scrollTop).toBe(0);
});

// The ramp: deeper into the zone means faster, so the user controls the
// speed by how far past the edge they push.
it("scrolls faster the deeper into the zone the pointer is", () => {
  const shallow = scroller();
  const { unmount } = renderHook(() => useEdgeAutoScroll({ current: shallow }, true));
  movePointerTo(500 - EDGE_ZONE + 5);
  tick();
  unmount();

  const deep = scroller();
  renderHook(() => useEdgeAutoScroll({ current: deep }, true));
  movePointerTo(500);
  tick();

  expect(deep.scrollTop).toBeGreaterThan(shallow.scrollTop);
  expect(deep.scrollTop).toBeLessThanOrEqual(MAX_SPEED);
});

// Past the container's edge — off the bottom of the window — the speed is
// capped rather than growing without limit.
it("caps the speed once the pointer is past the container's edge", () => {
  const el = scroller();
  renderHook(() => useEdgeAutoScroll({ current: el }, true));

  movePointerTo(5000);
  tick();

  expect(el.scrollTop).toBe(MAX_SPEED);
});

it("does nothing until the drag is active", () => {
  const el = scroller();
  renderHook(() => useEdgeAutoScroll({ current: el }, false));

  movePointerTo(500);
  tick(3);

  expect(el.scrollTop).toBe(0);
});

it("stops scrolling as soon as the drag ends", () => {
  const el = scroller();
  const { rerender } = renderHook(({ active }) => useEdgeAutoScroll({ current: el }, active), {
    initialProps: { active: true },
  });

  movePointerTo(500);
  tick();
  const atRelease = el.scrollTop;

  rerender({ active: false });
  tick(3);

  expect(el.scrollTop).toBe(atRelease);
});

// Reduced motion drops the ramp, not the feature: still scrolls, but at
// one steady rate rather than an accelerating one.
it("scrolls at a steady rate, still scrolling, under prefers-reduced-motion", () => {
  setReducedMotion(true);

  const shallow = scroller();
  const { unmount } = renderHook(() => useEdgeAutoScroll({ current: shallow }, true));
  movePointerTo(500 - EDGE_ZONE + 5);
  tick();
  unmount();

  const deep = scroller();
  renderHook(() => useEdgeAutoScroll({ current: deep }, true));
  movePointerTo(500);
  tick();

  expect(shallow.scrollTop).toBe(REDUCED_SPEED);
  expect(deep.scrollTop).toBe(REDUCED_SPEED);
});
