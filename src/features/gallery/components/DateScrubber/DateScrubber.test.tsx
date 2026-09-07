import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Tick } from "@/lib/media/timelineTicks";
import { DateScrubber } from "./DateScrubber";

const ticks: Tick[] = [
  { label: "March 2019", offsetRatio: 0, isYearStart: true },
  { label: "February 2019", offsetRatio: 0.5, isYearStart: false },
];

type ScrollStub = HTMLElement & { scrollTo: ReturnType<typeof vi.fn> };

/**
 * A stand-in for the grid's scroll container. jsdom gives an element no
 * layout at all — `scrollHeight` and `clientHeight` are both 0 and
 * `scrollTo` is unimplemented — so the numbers the scrubber does its
 * arithmetic on are supplied here explicitly.
 */
function scrollElementStub(over: Partial<Record<string, unknown>> = {}): ScrollStub {
  return {
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 200,
    scrollTo: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    ...over,
  } as unknown as ScrollStub;
}

/**
 * The track's own box, which jsdom reports as all zeros. 200px tall
 * starting at the top of the viewport, so a `clientY` reads directly as a
 * fraction of it.
 */
function stubTrackBox(el: HTMLElement, { top = 0, height = 200 } = {}) {
  el.getBoundingClientRect = () =>
    ({ top, bottom: top + height, height, left: 0, right: 8, width: 8, x: 0, y: top }) as DOMRect;
}

function renderScrubber(props: Partial<React.ComponentProps<typeof DateScrubber>> = {}) {
  const el = props.scrollElement ?? scrollElementStub();
  const view = render(
    <DateScrubber scrollElement={el} ticks={ticks} dateAt={() => "12 March 2019"} {...props} />,
  );
  const track = screen.getByTestId("scrubber-track");
  stubTrackBox(track);
  return { ...view, el: el as ScrollStub, track };
}

it("scrolls the element when the track is clicked", () => {
  const { el, track } = renderScrubber();

  fireEvent.pointerDown(track, { clientY: 50 });

  // Track is 200px tall, so clientY 50 is a quarter of the way down; the
  // scrollable range is scrollHeight - clientHeight = 800, so 0.25 * 800.
  expect(el.scrollTo).toHaveBeenCalledWith({ top: 200, behavior: "auto" });
});

it("shows the date for the dragged position", () => {
  const { track } = renderScrubber();

  fireEvent.pointerDown(track, { clientY: 50 });

  expect(screen.getByText("12 March 2019")).toBeInTheDocument();
});

// A scrub follows the pointer wherever it goes — off the track, over the
// photos — which is why the move listener lives on the document.
it("keeps scrolling as the pointer moves after the press", () => {
  const { el, track } = renderScrubber();

  fireEvent.pointerDown(track, { clientY: 50 });
  fireEvent.pointerMove(document, { clientY: 150 });

  expect(el.scrollTo).toHaveBeenLastCalledWith({ top: 600, behavior: "auto" });
});

it("stops following the pointer once it is released", () => {
  const { el, track } = renderScrubber();

  fireEvent.pointerDown(track, { clientY: 50 });
  fireEvent.pointerUp(document);
  fireEvent.pointerMove(document, { clientY: 150 });

  expect(el.scrollTo).toHaveBeenCalledTimes(1);
});

it("hides the date pill once the scrub ends", () => {
  const { track } = renderScrubber();

  fireEvent.pointerDown(track, { clientY: 50 });
  fireEvent.pointerUp(document);

  expect(screen.queryByText("12 March 2019")).not.toBeInTheDocument();
});

it("renders a label for each year-start tick", () => {
  renderScrubber({ dateAt: () => "" });

  expect(screen.getByText("2019")).toBeInTheDocument();
  expect(screen.queryByText("February 2019")).not.toBeInTheDocument();
});

it("exposes the handle as a slider with the date as its value text", () => {
  renderScrubber();

  expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "12 March 2019");
});

// A drag-select auto-scrolls the same container from its own animation
// loop. Two writers on one `scrollTop` would fight, so only one gesture
// may own it at a time.
it("refuses to scrub while another gesture owns the scroll container", () => {
  const { el, track } = renderScrubber({ disabled: true });

  fireEvent.pointerDown(track, { clientY: 50 });

  expect(el.scrollTo).not.toHaveBeenCalled();
  expect(screen.queryByText("12 March 2019")).not.toBeInTheDocument();
});

// The handle is focusable and carries `role="slider"`, so it has to answer
// the keys a slider answers — a reachable control that does nothing is the
// state this gallery is not allowed to have.
it("scrolls a page on PageDown and jumps to the ends on Home/End", () => {
  const { el } = renderScrubber();
  const slider = screen.getByRole("slider");

  // One viewport (clientHeight 200) of a 800px range is a quarter.
  fireEvent.keyDown(slider, { key: "PageDown" });
  expect(el.scrollTo).toHaveBeenLastCalledWith({ top: 200, behavior: "auto" });

  fireEvent.keyDown(slider, { key: "End" });
  expect(el.scrollTo).toHaveBeenLastCalledWith({ top: 800, behavior: "auto" });

  fireEvent.keyDown(slider, { key: "Home" });
  expect(el.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" });
});

// The gallery's grid-level keyboard handler listens on `document`. A key
// the slider has already acted on must not also move the tile focus.
it("keeps a key it handles from reaching the gallery's own handler", () => {
  const onDocumentKeyDown = vi.fn();
  document.addEventListener("keydown", onDocumentKeyDown);
  try {
    renderScrubber();

    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowDown" });
    expect(onDocumentKeyDown).not.toHaveBeenCalled();

    // A key it doesn't claim still passes straight through.
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowRight" });
    expect(onDocumentKeyDown).toHaveBeenCalledTimes(1);
  } finally {
    document.removeEventListener("keydown", onDocumentKeyDown);
  }
});

// The scrubber never writes `scrollTop` on its own; it reports where the
// container already is, so the wheel, trackpad and keyboard keep working
// exactly as before.
it("follows the container when something else scrolls it", () => {
  const listeners: (() => void)[] = [];
  const el = scrollElementStub({
    addEventListener: vi.fn((_: string, fn: () => void) => listeners.push(fn)),
  });
  renderScrubber({ scrollElement: el, dateAt: (r) => `ratio ${r}` });

  expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "0");

  el.scrollTop = 400;
  act(() => listeners.forEach((fn) => fn()));

  expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", "50");
});

it("renders nothing interactive when there is nothing to scroll", () => {
  const el = scrollElementStub({ scrollHeight: 200, clientHeight: 200 });
  const { track } = renderScrubber({ scrollElement: el });

  fireEvent.pointerDown(track, { clientY: 50 });

  expect((el as ScrollStub).scrollTo).not.toHaveBeenCalled();
});
