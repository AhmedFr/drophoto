import { useMemo, useState } from "react";
import { yearOf, type Tick } from "@/lib/media/timelineTicks";
import {
  EDGE_PADDING_PX,
  MIN_LABEL_SPACING_PX,
  TRACK_WIDTH_ACTIVE,
  TRACK_WIDTH_REST,
} from "./DateScrubber.constants";
import type { DateScrubberProps } from "./DateScrubber.types";
import { useScrubber } from "./useScrubber";

function prefersReducedMotion(): boolean {
  // `matchMedia` is absent in jsdom unless a test stubs it, and the honest
  // default for "we can't tell" is the unreduced one.
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/**
 * The year labels the track actually shows: the ticks that open a year,
 * thinned so two of them never land on top of each other. A library
 * spanning two decades puts its years within a few pixels of one another
 * wherever the photos are dense, and a stack of overlapping numbers is
 * worse than a gap.
 *
 * With no known track height (nothing measured yet) nothing is thinned —
 * dropping labels on a guess would be worse than briefly showing them all.
 */
function yearLabels(ticks: Tick[], trackHeight: number): Tick[] {
  const starts = ticks.filter((t) => t.isYearStart);
  if (trackHeight <= 0) return starts;
  const kept: Tick[] = [];
  let lastY = Number.NEGATIVE_INFINITY;
  for (const tick of starts) {
    const y = tick.offsetRatio * trackHeight;
    if (y - lastY < MIN_LABEL_SPACING_PX) continue;
    kept.push(tick);
    lastY = y;
  }
  return kept;
}

/**
 * Google Photos' date scrubber: a quiet strip down the right edge of the
 * grid that opens on hover to show the years the library spans, and can be
 * dragged to fly through all of it with the exact date of whatever is
 * under the handle shown in a pill.
 *
 * It is a supplement, never the only way to move: the container underneath
 * keeps its own native scrolling untouched (wheel, trackpad, keyboard,
 * Page Up/Down), and the handle just follows along. Only its own
 * `scrollbar-none` hides the native bar, and only because this replaces
 * what that bar was for.
 *
 * The two things it displays come from deliberately different sources. The
 * year labels are the layout's month headers, which is all a year needs;
 * the pill's date is `dateAt`, resolved from the timeline index, because
 * only the index knows what an individual photo's capture date is.
 */
export function DateScrubber({
  scrollElement,
  ticks,
  dateAt,
  disabled = false,
}: DateScrubberProps) {
  const [hovered, setHovered] = useState(false);
  const { trackRef, handleRef, ratio, scrubbing, scrollable, onPointerDown, onWheel, onKeyDown } =
    useScrubber(scrollElement, disabled, ticks);

  // Open while the pointer is over it or a scrub is in flight — a drag
  // that has wandered off the track must not collapse it mid-gesture.
  const expanded = hovered || scrubbing;
  const reduced = prefersReducedMotion();
  const dateLabel = dateAt(ratio);

  // The track is the full height of the scroll container, so that is the
  // pixel height the labels have to fit into.
  const labels = useMemo(
    () => yearLabels(ticks, scrollElement?.clientHeight ?? 0),
    [ticks, scrollElement],
  );

  /**
   * Where a position along the track is drawn, inset from both ends by
   * `EDGE_PADDING_PX` so nothing centred on it is clipped by the
   * container's edge. The handle, the year labels and the pointer mapping
   * in `useScrubber` all use this one run, so a label sits exactly where
   * the handle lands when it reaches that month.
   */
  const trackTop = (at: number) =>
    `calc(${EDGE_PADDING_PX}px + ${at} * (100% - ${EDGE_PADDING_PX * 2}px))`;

  const handleTop = trackTop(ratio);

  return (
    <div
      ref={trackRef}
      data-testid="scrubber-track"
      className="absolute top-0 right-0 bottom-0 z-20 select-none"
      style={{
        width: expanded ? TRACK_WIDTH_ACTIVE : TRACK_WIDTH_REST,
        transition: reduced ? undefined : "width 140ms ease-out",
        touchAction: "none",
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
    >
      <div
        aria-hidden
        className="absolute inset-y-0 right-0 left-0"
        style={{
          background: expanded ? "var(--surface-2)" : "transparent",
          borderLeft: expanded ? "1px solid var(--border-2)" : "1px solid transparent",
          opacity: expanded ? 1 : 0.9,
        }}
      />

      {/* Year labels fade in with the track: at rest there is nothing to
          read them against, and the strip is meant to be quiet. */}
      <div
        aria-hidden
        className="absolute inset-0 overflow-hidden font-mono text-[9px] tracking-[1px] text-faint"
        style={{
          opacity: expanded ? 1 : 0,
          transition: reduced ? undefined : "opacity 140ms ease-out",
        }}
      >
        {labels.map((tick, i) => (
          // Keyed by position as well as label: `buildLayout` supports a
          // month recurring non-consecutively (the `added_desc` sort puts
          // the same month in two places), so the label alone is not
          // unique.
          <span
            key={`${i}:${tick.label}`}
            className="absolute right-2 -translate-y-1/2 whitespace-nowrap"
            style={{ top: trackTop(tick.offsetRatio) }}
          >
            {yearOf(tick.label)}
          </span>
        ))}
      </div>

      {/*
        A slider only while there is something to scroll. With the whole
        library on one screen there is no value for it to report and no key
        it could answer, and a tab stop like that is exactly the reachable
        dead end this gallery is not allowed to have — so it stays a
        drawing instead.
      */}
      <div
        ref={handleRef}
        {...(scrollable
          ? {
              role: "slider",
              tabIndex: 0,
              "aria-label": "Scroll the gallery by date",
              "aria-orientation": "vertical" as const,
              "aria-valuemin": 0,
              "aria-valuemax": 100,
              "aria-valuenow": Math.round(ratio * 100),
              "aria-valuetext": dateLabel,
              onKeyDown,
            }
          : { "aria-hidden": true })}
        className="absolute right-0 left-0 -translate-y-1/2 outline-none focus-visible:ring-1 focus-visible:ring-ring"
        style={{ top: handleTop, height: 6 }}
      >
        <div
          className="absolute top-1/2 right-1 -translate-y-1/2 rounded-full"
          style={{
            width: expanded ? TRACK_WIDTH_ACTIVE - 8 : TRACK_WIDTH_REST - 2,
            height: 3,
            background: expanded || scrubbing ? "var(--foreground)" : "var(--border-3)",
          }}
        />
      </div>

      {/* The pill only appears during a scrub — that is the moment the
          exact date matters, and a label parked over the photos the rest
          of the time would just be in the way. */}
      {scrubbing && (
        <div
          className="pointer-events-none absolute -translate-y-1/2 border border-border-2 bg-surface px-2 py-1 font-mono text-[10px] whitespace-nowrap text-foreground"
          style={{ top: handleTop, right: TRACK_WIDTH_ACTIVE + 8 }}
        >
          {dateLabel}
        </div>
      )}
    </div>
  );
}
